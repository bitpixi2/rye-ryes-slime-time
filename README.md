# Rye-Rye’s Slime Time

![Rye-Rye’s Slime Time mobile preview](docs/rye-ryes-slime-time-mobile.png)

A tiny, touch-first slime maker for curious fingers. Pick a goo, toss in candy, then pull, poke, pinch, and wobble it across the whole screen.

## Play it

**[Play Rye-Rye’s Slime Time](https://new-project-please-just-a-simple.vercel.app)**

## What makes it goopy

- Three kid-friendly steps: **Goop → Mix-ins → Squish**
- A custom pressure-preserving Verlet soft body with spring edges and volume recovery
- Real multi-touch: two fingers can pull different edges at the same time
- Procedural Web Audio “blorps,” pops, and sprinkle chimes—no audio files to preload
- Short vibration patterns through the browser Vibration API where supported, with visual/audio feedback everywhere else
- An original AI-generated clay-candy sprinkle texture, plus stars, beads, and animated glitter
- Responsive full-goo mode, keyboard controls, reduced-motion support, and a locally saved recipe
- No runtime dependencies and no tracking

## Run it

```bash
npm install
npm run dev
```

Build the static site with:

```bash
npm run build
```

## Controls

- Touch/mouse: grab any slime edge and pull
- Multi-touch: grab two edges and stretch
- Tap/poke: make a ripple and a blorp
- Keyboard: arrow keys nudge the slime; Space or Enter pokes it

## Open-source research

The interaction was researched against several excellent open-source projects:

- [Matter.js](https://github.com/liabru/matter-js) for constraint-based 2D physics and its soft-body examples
- [verlet-js](https://github.com/subprotocol/verlet-js) for a compact Verlet-integration reference
- [Paper.js](https://github.com/paperjs/paper.js) for touch-path smoothing ideas
- [howler.js](https://github.com/goldfire/howler.js) for proven mobile audio-unlock patterns

Rye-Rye’s Slime Time does not ship those libraries. Its physics, canvas renderer, and Web Audio instruments are purpose-built in `src/main.js`.

## Generated art

`public/candy-sprinkles.jpg` is original project art made with OpenAI's built-in image generation tool. It was prompted as a seamless-feeling square tile of chunky rainbow sprinkles, jelly stars, wobbly dots, gummy moons, and confetti curls in a soft-clay/cut-paper style, with no text, faces, logos, or watermark.

## License

[MIT](LICENSE)
