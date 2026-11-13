/** LiveKit connection: publishes the mic, receives the agent's voice, events and captions. */
import { AVATAR_TOPIC, type AgentState, type AvatarEvent, decodeEvent } from "@metaavatar/protocol";
import {
  ConnectionState,
  type Participant,
  ParticipantKind,
  type RemoteParticipant,
  type RemoteTrack,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";

export interface Caption {
  id: string;
  role: "user" | "agent";
  text: string;
  final: boolean;
}

export interface SessionHandlers {
  onAgentAudio(track: MediaStreamTrack): void;
  onAgentAudioEnded(): void;
  /** Video the agent publishes (neural renderer); null when it stops. */
  onAgentVideo(track: MediaStreamTrack | null): void;
  onEvent(ev: AvatarEvent): void;
  onAgentState(state: AgentState): void;
  onCaption(c: Caption): void;
  onConnection(state: "connecting" | "connected" | "reconnecting" | "disconnected", detail?: string): void;
  onAgentJoined(joined: boolean): void;
}

const AGENT_STATE_ATTR = "lk.agent.state";
const TRANSCRIPTION_TOPIC = "lk.transcription";
/** LiveKit Agents reads typed user messages from this topic. */
const CHAT_TOPIC = "lk.chat";

export class AgentConnection {
  readonly room = new Room({ adaptiveStream: true, dynacast: true });

  constructor(private h: SessionHandlers) {
    const r = this.room;
    r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, p: RemoteParticipant) => {
      if (!this.isAgent(p)) return;
      if (track.kind === Track.Kind.Audio) this.h.onAgentAudio(track.mediaStreamTrack);
      if (track.kind === Track.Kind.Video) this.h.onAgentVideo(track.mediaStreamTrack);
    });
    r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, p: RemoteParticipant) => {
      if (!this.isAgent(p)) return;
      if (track.kind === Track.Kind.Audio) this.h.onAgentAudioEnded();
      if (track.kind === Track.Kind.Video) this.h.onAgentVideo(null);
    });
    r.on(RoomEvent.DataReceived, (payload, _p, _kind, topic) => {
      if (topic !== AVATAR_TOPIC) return;
      const ev = decodeEvent(payload);
      if (ev) this.h.onEvent(ev);
    });
    r.on(RoomEvent.ParticipantAttributesChanged, (changed: Record<string, string>, p: Participant) => {
      const s = changed[AGENT_STATE_ATTR];
      if (s && this.isAgent(p)) this.h.onAgentState(s as AgentState);
    });
    r.on(RoomEvent.ParticipantConnected, (p) => this.isAgent(p) && this.h.onAgentJoined(true));
    r.on(RoomEvent.ParticipantDisconnected, (p) => this.isAgent(p) && this.h.onAgentJoined(false));
    r.on(RoomEvent.ConnectionStateChanged, (s) => {
      const map: Record<ConnectionState, Parameters<SessionHandlers["onConnection"]>[0]> = {
        [ConnectionState.Connecting]: "connecting",
        [ConnectionState.Connected]: "connected",
        [ConnectionState.Reconnecting]: "reconnecting",
        [ConnectionState.SignalReconnecting]: "reconnecting",
        [ConnectionState.Disconnected]: "disconnected",
      };
      this.h.onConnection(map[s] ?? "connecting");
    });
    r.registerTextStreamHandler(TRANSCRIPTION_TOPIC, async (reader, info) => {
      const role: Caption["role"] = info.identity === r.localParticipant.identity ? "user" : "agent";
      const attrs = reader.info.attributes ?? {};
      const id = attrs["lk.segment_id"] ?? reader.info.id;
      const final = attrs["lk.transcription_final"] === "true";
      let text = "";
      for await (const chunk of reader) {
        text += chunk;
        this.h.onCaption({ id, role, text, final: false });
      }
      this.h.onCaption({ id, role, text, final: final || role === "agent" });
    });
  }

  private isAgent(p: Participant): boolean {
    return p.kind === ParticipantKind.AGENT;
  }

  async connect(url: string, token: string): Promise<void> {
    this.h.onConnection("connecting");
    await this.room.connect(url, token, { autoSubscribe: true });
    for (const p of this.room.remoteParticipants.values()) {
      if (!this.isAgent(p)) continue;
      this.h.onAgentJoined(true);
      for (const pub of p.audioTrackPublications.values()) {
        if (pub.track) this.h.onAgentAudio(pub.track.mediaStreamTrack);
      }
    }
  }

  async setMicEnabled(on: boolean): Promise<MediaStreamTrack | null> {
    await this.room.localParticipant.setMicrophoneEnabled(on, {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    const pub = this.room.localParticipant.getTrackPublication(Track.Source.Microphone);
    return on ? (pub?.track?.mediaStreamTrack ?? null) : null;
  }

  /** Send a typed message to the agent (text fallback when the mic isn't usable). */
  async sendText(text: string): Promise<void> {
    await this.room.localParticipant.sendText(text, { topic: CHAT_TOPIC });
  }

  async disconnect(): Promise<void> {
    this.room.unregisterTextStreamHandler(TRANSCRIPTION_TOPIC);
    await this.room.disconnect();
  }
}
