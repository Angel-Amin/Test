# Second in Command

A zombie-apocalypse **logistics and strategy** game for Android. It is not a base builder.

You are the executive officer of a survivor outpost in an old limestone quarry. The Commander sets the goals. You make them possible: who goes where, with what, what the base spends its parts on, and whether the next horde meets an ambush on the road or a wall at the gate.

## Core ideas

| Pillar | How it plays |
|---|---|
| **The base grows from its needs** | You never place buildings. When conditions call for one (wounded piling up, the pantry running low, a horde sighted, people sleeping in trucks), someone at the base *asks* for it. You **approve** the request (it costs parts up front, then builder work-days) or **dismiss** it (morale drops, and trust drops too if the Commander backed it). Dismissed needs come back, more urgent. |
| **Logistics first** | Every person eats 1 food and drinks 1 water a day. Field teams pack rations, trucks burn fuel per road, and storage has caps, so overflow rots. Civilians are assigned to farming, water hauling, workshop, construction and medical work. |
| **Operations on a regional map** | Send **recon**, **supply runs**, **clearing ops** or **intercepts** to 10 sites connected by roads. You choose the team (soldiers fight, civilians carry and gather, trucks halve travel and carry 60), the ammo, the time on site and the priority cargo. Risk is estimated from your intel, which can go stale. |
| **Military, to an extent** | You plan the operations, but the Commander's standing order sets a minimum garrison. Hordes spawn at the map edges and walk toward the quarry one road per day. A watchtower spots them earlier. Ambush them on the way or hold the walls. |
| **Answering to the Commander** | There are six sequential directives: scout the valley, fill the larder, take the hospital, build an ammo reserve, recover the radio relay, then hold until relief on day 30. Trust rises and falls with your results. At zero you are relieved of command. |

Endings depend on how many people make it to day 30, whether you recovered the relay, and how much the Commander trusts you.

## Running it

```bash
npm install
npm run dev        # play in a browser at the printed URL (use phone-size devtools)
npm test           # engine tests, including a balance check with scripted players
npm run build      # type-check + production web bundle in dist/
```

### Android

The web build is wrapped with [Capacitor 7](https://capacitorjs.com/). You need JDK 21 and the Android SDK (platform 35, build-tools 35).

```bash
export ANDROID_HOME=/path/to/android-sdk
npm run android:apk
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Or open the project in Android Studio with `npx cap open android` and run it on a device or emulator. The app is locked to portrait and runs on Android 6.0+ (minSdk 23, targetSdk 35). Saves are kept on the device.

To regenerate the launcher icons and splash screens from the source art in `assets/`, run `npx @capacitor/assets generate --android`.

## Code layout

```
src/game/      pure, deterministic game engine (no DOM)
  types.ts     state shapes
  data.ts      map sites, facilities and their need triggers, Commander directives
  derived.ts   computed values: defense, capacity, paths, risk estimate
  engine.ts    day cycle: production, medicine, construction, operations,
               hordes and sieges, needs, events, directives, endings, saves
  rng.ts       seeded RNG stored in the save (same seed + same choices = same game)
  sim.ts       scripted players used by the balance tests
src/ui/        mobile UI (vanilla TypeScript, no framework)
src/main.ts    UI state and input handling
android/       Capacitor Android project
```

### Balance

`npm test` plays 12 seeded campaigns with two scripted players. One does nothing; the other is a simple rule-based quartermaster. Doing nothing must always lose. The scripted player must win at least sometimes. Over 40 seeds it currently wins about 1 in 4 campaigns while usually completing only one directive, so a human who works the directives should do better.
