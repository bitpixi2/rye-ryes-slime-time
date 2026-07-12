# Rye-Rye’s Slime Time

Rye-Rye’s Slime Time is a playful, touch-first slime table for kids. Choose a slime style and color, add toppings, then poke, swirl, stretch, and squish it with responsive physics, sound, and mobile haptics.

**[Play Rye-Rye’s Slime Time](https://new-project-please-just-a-simple.vercel.app)**

![Glowy slime with colorful toppings](docs/glowy-slime-desktop.png)

## Technical architecture

```mermaid
flowchart LR
    UI["Kid-friendly chooser<br/>Type · Color · Toppings"] --> State["Recipe and interaction state"]
    Touch["Touch / mouse input"] --> Feel["Resistance, multi-touch<br/>and haptic controller"]
    Feel --> State
    State --> Router{"Slime engine"}
    Router --> Fluid["Glowy<br/>WebGL fluid simulation"]
    Router --> Volume["Blobby<br/>Three.js marching cubes"]
    Router --> Bingsu["Squishy<br/>Canvas particle field"]
    Router --> Putty["Stretchy<br/>Three.js tube geometry"]
    State --> Toppings["Canvas topping layer"]
    State --> Audio["Interaction-gated<br/>sample loops"]
    Fluid --> Stage["Full-screen slime stage"]
    Volume --> Stage
    Bingsu --> Stage
    Putty --> Stage
    Toppings --> Stage
```

![Stretchy slime with animal faces and stars](docs/stretchy-slime-desktop.png)

Built with Vite, Three.js, WebGL Fluid Enhanced, Canvas 2D, and the Web Audio and Vibration APIs.

## Run locally

```bash
npm install
npm run dev
```

[MIT licensed](LICENSE).
