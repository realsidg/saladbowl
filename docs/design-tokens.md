# Saladbowl design tokens ("Paper slips")

Subject: the paper game. Names scribbled on slips, folded into a bowl, passed round a living room. Audience: friends in one room, each on a phone, often in dim light. Primary job of every screen: tell this person, at a glance, what they should do right now.

## Colour

| Name | Hex | Role |
|---|---|---|
| Water | `#14535c` | page background (the bowl) |
| Deep water | `#0e3d44` | sunken surfaces, pressed states, input wells |
| Foam | `#d9f2ef` | secondary text and outlines on water |
| Paper | `#fffdf6` | the slip, the primary button, sheets |
| Ink | `#1d2a6b` | handwriting on the slip, text on paper |
| Tangerine | `#ff8a1f` | team colour, dark text (`#0f2a2e`) on it |
| Lagoon | `#7fd6cc` | team colour, dark text (`#0f2a2e`) on it |

Rule line on the slip: `#cfe3f5`.

**"Got it" colour (decided here):** a solid **Paper** button with **Ink** text. The mockup's yellow `#ffd23f` sat next to Tangerine and read as "the Tangerine button". Paper is neither team's colour, ties the button to the slip it acts on, and has the highest contrast on Water. Skip is a Foam outline on Water: clearly secondary.

## Type

- **Kalam 700** for the word on the slip and only there. It is the one handwritten thing, the way the real slips are.
- **Rubik** for everything else: 500 body, 700 headings and buttons, 900 for the big countdown and scores (tabular figures).
- Scale (px): 14, 16, 20, 28, 40, 64, 112. Sentence case. No all-caps labels, no arrows on buttons, no middle-dot meta strings ("Round 2: Charades").

## Layout

One column, max 480 px wide, centred on bigger screens. Status line at the top (round, your team, mute), the main thing in the middle, actions pinned to the bottom thumb zone above the safe area.

```
┌──────────────────────┐
│ Round 2: Charades  🔈│  status
│                      │
│      ┌────────┐      │
│      │  slip  │      │  the one bold element
│      └────────┘      │
│                      │
│ [      Got it      ] │  56 px+, paper
│ [       Skip       ] │  outline
└──────────────────────┘
```

Text is left-aligned in lists and forms; the slip word, countdown and score are centred.

## Principles

1. The slip is the hero. Everything around it is quiet.
2. One motion moment: the slip slides in (about 200 ms, ease-out) on each new card. Presses scale to 0.97. Nothing animates on its own otherwise; `prefers-reduced-motion` keeps only fades.
3. Readable from arm's length in a dim room: big numbers, high contrast, no thin type.
4. Tell people what to do next in plain words: "Start my turn", "Waiting for Anu to start".
