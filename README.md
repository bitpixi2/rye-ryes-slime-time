# Rye-Rye’s Slime Time

Rye-Rye’s Slime Time is a playful, touch-first slime table for kids. Choose a slime style and color, add toppings, then poke, swirl, stretch, and squish it with responsive physics, sound, and mobile haptics.

**[Play Rye-Rye’s Slime Time](https://new-project-please-just-a-simple.vercel.app)**

![Glowy slime with colorful toppings](docs/glowy-slime-desktop.png)

## Technical architecture

```mermaid
flowchart TB
    UI["Categories"] --> Type["1 · Choose a type<br/>Four rendering engines"]
    Type --> Engines["Glowy · WebGL fluid<br/>Blobby · Three.js volume<br/>Puffy-Pop · Three.js popping puffs<br/>Stretchy · Three.js geometry"]
    Engines --> Color["2 · Choose a color<br/>Shared slime palettes"]
    Color --> Toppings["3 · Add toppings<br/>Canvas asset layer"]
    Toppings --> Stage["4 · Fill the screen<br/>Slime, ElevenLabs sounds and haptics"]
    Stage -. "Choose again" .-> UI

    classDef berry fill:#f45ab4,stroke:#6c25b8,color:#ffffff,stroke-width:2px
    classDef lime fill:#9bea72,stroke:#25865f,color:#173a2b,stroke-width:2px
    classDef mango fill:#ffbd59,stroke:#d95a69,color:#4b2630,stroke-width:2px
    classDef aqua fill:#62e6e1,stroke:#237bd7,color:#17334d,stroke-width:2px
    classDef grape fill:#9a55ea,stroke:#5421a8,color:#ffffff,stroke-width:2px

    class UI berry
    class Type,Engines grape
    class Color aqua
    class Toppings lime
    class Stage mango
```

![Stretchy slime with animal faces and stars](docs/stretchy-slime-desktop.png)

## The joy of slime

Slime turns texture, repetition, and transformation into open-ended play. For some autistic people, self-chosen tactile input and sensory or fidget toys can be comforting or support self-regulation, although sensory preferences are individual and slime will not suit everyone ([National Autistic Society](https://www.autism.org.uk/advice-and-guidance/about-autism/sensory-processing)). A screen cannot reproduce all the pressure, shear, weight, and stiffness of a physical toy, so software experiments like this one use responsive motion, resistance, sound, and vibration to suggest a small part of that tactile and kinaesthetic experience ([review of haptic virtual-object research](https://pmc.ncbi.nlm.nih.gov/articles/PMC9919508/)).

<table>
  <tr>
    <td width="50%"><img src="docs/slime-gallery-glowy.png" alt="Glowy slime swirled across a blue table" /></td>
    <td width="50%"><img src="docs/slime-gallery-blobby.png" alt="Blobby green slime with colorful toppings" /></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/slime-gallery-squishy.png" alt="Puffy-Pop aqua slime with sprinkles and beads" /></td>
    <td width="50%"><img src="docs/slime-gallery-stretchy.png" alt="Stretchy mango slime with colorful toppings" /></td>
  </tr>
</table>

Built with Vite, Three.js, WebGL Fluid Enhanced, Canvas 2D, the Web Audio and Vibration APIs, and sounds from ElevenLabs.

[MIT licensed](LICENSE).
