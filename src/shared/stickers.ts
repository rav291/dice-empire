// Sticker album: 6 sets x 9 stickers. Art = Fluent Emoji 3D PNG at /assets/stickers/<id>.png
// `emoji` is the folder name in github.com/microsoft/fluentui-emoji/assets (assets agent may
// substitute a close emoji if one is missing — keep the id stable).

export interface StickerDef { id: string; set: string; name: string; emoji: string; stars: 1 | 2 | 3 | 4 | 5 }
export interface StickerSet { id: string; name: string; color: string; rewardDice: number }

export const STICKER_SETS: StickerSet[] = [
  { id: 'snacks', name: 'Snack Attack', color: '#ff8a3d', rewardDice: 60 },
  { id: 'wild', name: 'Wild Friends', color: '#3ccf6e', rewardDice: 80 },
  { id: 'travel', name: 'Globetrotter', color: '#3aa8ff', rewardDice: 100 },
  { id: 'sports', name: 'Game Day', color: '#ff4f6d', rewardDice: 120 },
  { id: 'show', name: 'Showtime', color: '#a465ff', rewardDice: 150 },
  { id: 'vault', name: 'Treasure Vault', color: '#ffc531', rewardDice: 200 },
];

const STARS: StickerDef['stars'][] = [1, 1, 1, 2, 2, 3, 3, 4, 5];

const RAW: Record<string, [string, string][]> = {
  snacks: [['Pizza', 'Pizza'], ['Burger', 'Hamburger'], ['Donut', 'Doughnut'], ['Soft Serve', 'Soft ice cream'], ['Taco', 'Taco'], ['Sushi', 'Sushi'], ['Popcorn', 'Popcorn'], ['Melon', 'Watermelon'], ['Party Cake', 'Birthday cake']],
  wild: [['Pup', 'Dog face'], ['Penguin', 'Penguin'], ['Koala', 'Koala'], ['Owl', 'Owl'], ['Turtle', 'Turtle'], ['Octopus', 'Octopus'], ['Butterfly', 'Butterfly'], ['Dolphin', 'Dolphin'], ['Hedgehog', 'Hedgehog']],
  travel: [['Jet', 'Airplane'], ['Sailboat', 'Sailboat'], ['Ocean Liner', 'Ship'], ['Island', 'Desert island'], ['Campsite', 'Camping'], ['Volcano', 'Volcano'], ['Rainbow', 'Rainbow'], ['Big Wheel', 'Ferris wheel'], ['Coaster', 'Roller coaster']],
  sports: [['Football', 'Soccer ball'], ['Hoops', 'Basketball'], ['Gridiron', 'American football'], ['Tennis', 'Tennis'], ['Bowling', 'Bowling'], ['Skateboard', 'Skateboard'], ['Boxing', 'Boxing glove'], ['Frisbee', 'Flying disc'], ['Ice Skate', 'Ice skate']],
  show: [['Guitar', 'Guitar'], ['Trumpet', 'Trumpet'], ['Sax', 'Saxophone'], ['Violin', 'Violin'], ['Drum', 'Drum'], ['Mic', 'Microphone'], ['Headphones', 'Headphone'], ['Palette', 'Artist palette'], ['Action!', 'Clapper board']],
  vault: [['Gem', 'Gem stone'], ['Old Key', 'Old key'], ['Ring', 'Ring'], ['Compass', 'Compass'], ['Money Bag', 'Money bag'], ['Crystal Ball', 'Crystal ball'], ['Magic Wand', 'Magic wand'], ['Crown', 'Crown'], ['Dragon', 'Dragon']],
};

export const STICKERS: StickerDef[] = STICKER_SETS.flatMap((s) =>
  RAW[s.id].map(([name, emoji], i) => ({ id: `${s.id}-${i + 1}`, set: s.id, name, emoji, stars: STARS[i] })),
);

export const PACK_NAMES: Record<number, string> = { 1: 'Green Pack', 2: 'Yellow Pack', 3: 'Pink Pack', 4: 'Blue Pack', 5: 'Gold Pack' };
