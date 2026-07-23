# hype-audio Clip Art Prompts (ChatGPT)

Each prompt is complete and standalone — copy the whole block into ChatGPT,
download the PNG, and save it directly over the matching placeholder file in
`images/clips/`. Same filename = no manifest edit needed.

Style is gritty/intense photorealism — harder and more aggressive than a
typical calm wellness-app look, matching hardcore mindset/training content.
Ask ChatGPT for a square (1:1) image for every one of these — they render as
small 44x44 rounded thumbnails, so a busy or off-center composition won't read
at that size.

## goggins — `images/clips/goggins.png`

> Photorealistic photograph, square 1:1, extreme close crop. A sledgehammer mid-swing striking a truck tire in near-total darkness, sparks of dust caught in one hard side-light, everything else in heavy black shadow. Raw, punishing effort — no gym equipment, no polish. Harsh contrast, gritty texture, grain. No text, no watermarks, no visible face — hands, tire, and hammer only.

## purpose — `images/clips/purpose.png`

> Photorealistic photograph, square 1:1. A single bare lightbulb hanging in a dark, empty concrete room, harsh cone of light hitting the floor directly below it, everything past the light's edge falling to black. Stark, deliberate, undecorated. High contrast, gritty texture. No text, no watermarks, no people.

## stoicism — `images/clips/stoicism.png`

> Photorealistic photograph, square 1:1. A weathered stone bust or column fragment lying broken in dark rubble, one hard shaft of cold light cutting across it, everything else in deep shadow. Ancient, unmoved, indifferent to ruin. Harsh directional lighting, desaturated cold tones against black. No text, no watermarks, no visible faces.

## faith — `images/clips/faith.png`

> Photorealistic photograph, square 1:1. A worn leather Bible lying open on a dark wooden surface, one warm shaft of amber light falling across the page, the rest of the frame in near-black shadow. Reverent but still intense — warm light against heavy dark, not soft or pastel. No text legible on the page, no watermarks, no people.

## carl — `images/clips/carl.png`

> Photorealistic photograph, square 1:1. A single dumbbell resting on a dark gym floor beside an open journal and pen, one hard warm light source from above, everything past the light pool falling to black. Personal, disciplined, unglamorous — the actual tools of a real routine, not a stock-photo gym. Harsh contrast, gritty texture. No text legible in the journal, no watermarks, no people.

## default — `images/clips/default.png`

> Photorealistic photograph, square 1:1. A single ember glowing in cold dark ash, faint warm light, everything else in near-total black. Neutral, intense, unattached to any specific figure — a fallback image, not tied to a person or theme. No text, no watermarks, no people.

---

# Home-screen tile backgrounds

Each of the 4 big pillar tiles on the home screen (`index.html` `.tile`
elements) is a **2x2 photo-grid mosaic**, not one full-bleed image — comic
panel style. The code looks for up to 4 numbered files per pillar:
`images/home/<pillar>-1.png` through `<pillar>-4.png`. Any slot that's
missing just renders as an empty dark placeholder, so you can fill them in
one at a time.

**Ask ChatGPT for portrait orientation 1024x1536px, 1024x1536, for every slot.** Each
grid cell is roughly square-to-portrait with `background-size: cover`, and
the whole tile has a dark gradient fading the bottom ~45% to black for text
legibility — keep each subject in the **upper half** of its own frame.
Square or landscape output will crop wrong. Save as PNG even if ChatGPT
gives a JPG — the code references `.png`.

Use 4 different angles/moments per pillar (not the same shot 4x) so the
grid actually reads as a mosaic.

## mindset — `images/home/mindset-1.png` through `mindset-4.png`

> Gritty desaturated cinematic photo, portrait orientation 1024x1536px, silhouette of a lone runner sprinting on a dark beach at dawn, harsh backlight, sand kicking up, "can't break me" grit, subject in the upper half of frame, no text, no logos

> Gritty desaturated cinematic photo, portrait orientation 1024x1536px, a small group of special-forces-style operators running in formation on a dark beach at dawn, harsh backlight, punishing endurance, subject in the upper half of frame, no text, no logos

> Gritty desaturated cinematic photo, portrait orientation 1024x1536px, close-up of bare feet pounding through wet sand mid-stride at dawn, harsh low backlight, spray of water and sand, subject in the upper half of frame, no text, no logos

> Gritty desaturated cinematic photo, portrait orientation 1024x1536px, a lone figure collapsed to one knee on a dark beach at dawn, catching breath, refusing to quit, harsh backlight, subject in the upper half of frame, no text, no logos

## iron — `images/home/iron-1.png` through `iron-4.png`

> Gritty black-and-white or heavily desaturated photo, portrait orientation 1024x1536px, old-school hardcore bodybuilding gym straight out of the early 1990s — like Dorian Yates' Temple Gym — a rusty chrome barbell loaded with worn iron plates on the floor, chalk dust hanging in the air, one harsh overhead light, bare concrete floor, no modern equipment, subject in the upper half of frame, no text, no logos

> Gritty black-and-white or heavily desaturated photo, portrait orientation 1024x1536px, close-up of chalked hands gripping a worn barbell mid-lift, straining forearm veins, harsh overhead light, raw 1990s hardcore gym atmosphere, subject in the upper half of frame, no text, no logos

> Gritty black-and-white or heavily desaturated photo, portrait orientation 1024x1536px, a stack of heavy old iron plates piled against a cracked concrete wall, single hard light source, dust in the air, subject in the upper half of frame, no text, no logos

> Gritty black-and-white or heavily desaturated photo, portrait orientation 1024x1536px, a bodybuilder mid-deadlift in a dim old-school gym, back turned, straining under the bar, harsh overhead light, subject in the upper half of frame, no text, no logos

## faith — `images/home/faith-1.png` through `faith-4.png`

> Cinematic painterly close-up of Jesus Christ's face, portrait orientation 1024x1536px, serene and weathered, dramatic single-source light from above, warm gold and amber tones fading to black, face in the upper half of frame, no text

> Cinematic painterly image, portrait orientation 1024x1536px, a wooden cross standing alone on a hill at dusk, dramatic warm backlight, fading to black at the base, cross in the upper half of frame, no text

> Cinematic close-up, portrait orientation 1024x1536px, praying hands clasped around a wooden cross pendant, warm single-source light, dark background fading to black, subject in the upper half of frame, no text

> Cinematic painterly photo, portrait orientation 1024x1536px, a worn leather Bible open on a dark surface with a single shaft of warm light falling across the page, subject in the upper half of frame, no text

## carl — `images/home/carl-1.png` through `carl-4.png`

Real photos, not ChatGPT-generated. `carl-1.png` is already sourced from
`G:\My Drive\Physique\IMG_0278.jpg`. Drop 3 more into `carl-2.png`,
`carl-3.png`, `carl-4.png` whenever you've got them — any aspect ratio
works, `cover` crop handles it.
