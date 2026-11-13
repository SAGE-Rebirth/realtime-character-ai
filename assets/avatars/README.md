# Avatar models

Every `.vrm` file in this folder appears in Studio under **Avatars** and in each agent's
**Appearance** tab. The `.vrm` files themselves are git-ignored (they are large); the notes beside
them and this guide are tracked.

## Add a model

Either way works:

- **In Studio:** Avatars → *Add a VRM avatar* (drop the file or choose it). It is saved here under
  its own file name.
- **By hand:** copy the `.vrm` into this folder. It shows up the next time the page loads.

Then open an agent → **Appearance**, pick the model, and use **Body language** on the same tab to
play every gesture and expression on it.

### Notes beside a model (optional, recommended)

Put a file named `<model file>.json` next to the model, for example `Teacher.vrm.json`:

```json
{
  "name": "Ms Hale",
  "source": "https://hub.vroid.com/en/characters/...",
  "licence": "Creator's terms: commercial use allowed, credit required (Creator Name)."
}
```

Studio shows the name in the list, and the path, licence and source when the model is selected.
Always record the licence: it is the only proof of what we are allowed to do with a model.

## What a model needs to work well

- VRM 0.x or VRM 1.0 (both are supported), up to 80 MB.
- Mouth shapes `aa ih ou ee oh` (called `a i u e o` in VRM 0.x) for lip-sync, and `blink`.
- Expressions `happy sad angry relaxed`; `surprised` exists only in VRM 1.0.
- A standard humanoid skeleton. Hair and clothes with spring bones move on their own.

Models exported from VRoid Studio have all of these.

## Where to get models

| Source | Link | Licence | Good for |
|---|---|---|---|
| VRoid Studio (make your own) | https://vroid.com/en/studio | You own what you make; check the terms of any preset items you use | The surest way to get exactly the look you want (a teacher, a suit). Free, about 15 minutes |
| VRoid Hub | https://hub.vroid.com/en | Set by each creator. Open a model and read *Conditions of use* | The largest catalogue. Search "teacher", "suit" or "OL", then use *Filter by conditions of use*. Downloading needs a free pixiv account |
| pixiv three-vrm examples | https://github.com/pixiv/three-vrm/tree/dev/packages/three-vrm/examples/models | VRM Public License 1.0, commercial use allowed | Clean reference models, VRM 1.0 |
| VRoid sample models (mirror) | https://github.com/madjin/vrm-samples | Beta samples are CC0; `AvatarSample_A/B/C` have their own conditions | Quick test models |
| VRoid's conditions for its samples | https://vroid.pixiv.help/hc/en-us/articles/4402614652569 | | Which samples are CC0 and which are not |
| Open Source Avatars | https://www.opensourceavatars.com/en/gallery | Mostly CC0 (set per collection) | 300+ stylised characters: robots, creatures, mascots |
| 100Avatars | https://github.com/madjin/100avatars | CC0 | Cartoon characters for games |
| VRM licence explained | https://vrm.dev/en/vrm/meta/license/ | | What each permission field inside a VRM means |
| VRM Public License 1.0 | https://vrm.dev/licenses/1.0/ | | The text of the licence |

### Checking a licence

A VRM carries its permissions inside the file. Before using a model for anything public, check:

1. **Commercial use** is allowed (VRM 0.x `commercialUssageName: Allow`; VRM 1.0
   `commercialUsage: corporation` or `personalProfit`).
2. **Who may use the avatar** is "everyone", not only the author.
3. **Credit**: whether the creator must be named.
4. The download page's own terms, which override nothing but may add conditions.

## Models in this folder

| File | Shown as | Source | Licence | Notes |
|---|---|---|---|---|
| `VRM1_Constraint_Twist_Sample.vrm` | Mira (pixiv VRM 1.0 sample) | pixiv three-vrm examples | VRM Public License 1.0, © 2022 pixiv Inc. Commercial use, modification and redistribution allowed; credit not required | VRM 1.0, full expression set, 57 hair spring joints. Used by the demo agent Ava's draft. Looks young and casual |
| `Victoria_Rubin.vrm` | Victoria Rubin (VRoid beta sample) | madjin/vrm-samples, `vroid/beta` | CC0 (in the file's metadata) | VRM 0.x. Idol-style character |
| `Vita.vrm` | Vita (VRoid beta sample) | same | CC0 | VRM 0.x. Idol-style character |
| `Vivi.vrm` | Vivi (VRoid beta sample) | same | CC0 | VRM 0.x. Idol-style character |
| `AvatarSample_B.vrm` | AvatarSample B (VRoid sample) | madjin/vrm-samples, `vroid/stable` | VRoid sample conditions of use (not CC0); metadata allows commercial use | VRM 0.x. Read the conditions before shipping it |

None of these is the professional adult character we want for demos (a teacher, someone in a
suit). The quickest routes are VRoid Studio or a VRoid Hub model whose conditions allow commercial
use; drop the file here and add its notes.

## Known limits

- Gestures were tuned on the built-in character. On some models the "think" hand lands on the
  cheek rather than the chin.
- "Surprised" does nothing on VRM 0.x models, which have no such expression.
