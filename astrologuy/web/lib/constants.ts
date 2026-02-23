// Constants extracted from lunar-mcp src/index.ts

export const WESTERN_ZODIAC = [
  { name: "Aries", symbol: "\u2648", element: "Fire", modality: "Cardinal", start: 0 },
  { name: "Taurus", symbol: "\u2649", element: "Earth", modality: "Fixed", start: 30 },
  { name: "Gemini", symbol: "\u264A", element: "Air", modality: "Mutable", start: 60 },
  { name: "Cancer", symbol: "\u264B", element: "Water", modality: "Cardinal", start: 90 },
  { name: "Leo", symbol: "\u264C", element: "Fire", modality: "Fixed", start: 120 },
  { name: "Virgo", symbol: "\u264D", element: "Earth", modality: "Mutable", start: 150 },
  { name: "Libra", symbol: "\u264E", element: "Air", modality: "Cardinal", start: 180 },
  { name: "Scorpio", symbol: "\u264F", element: "Water", modality: "Fixed", start: 210 },
  { name: "Sagittarius", symbol: "\u2650", element: "Fire", modality: "Mutable", start: 240 },
  { name: "Capricorn", symbol: "\u2651", element: "Earth", modality: "Cardinal", start: 270 },
  { name: "Aquarius", symbol: "\u2652", element: "Air", modality: "Fixed", start: 300 },
  { name: "Pisces", symbol: "\u2653", element: "Water", modality: "Mutable", start: 330 },
] as const;

export const CHINESE_ANIMALS: Record<string, string> = {
  "\u9F20": "Rat", "\u725B": "Ox", "\u864E": "Tiger", "\u5154": "Rabbit",
  "\u9F99": "Dragon", "\u86C7": "Snake", "\u9A6C": "Horse", "\u7F8A": "Goat",
  "\u7334": "Monkey", "\u9E21": "Rooster", "\u72D7": "Dog", "\u732A": "Pig",
};

export const HEAVENLY_STEMS: Record<string, { pinyin: string; element: string }> = {
  "\u7532": { pinyin: "Ji\u01CE", element: "Wood" },
  "\u4E59": { pinyin: "Y\u01D0", element: "Wood" },
  "\u4E19": { pinyin: "B\u01D0ng", element: "Fire" },
  "\u4E01": { pinyin: "D\u012Bng", element: "Fire" },
  "\u620A": { pinyin: "W\u00F9", element: "Earth" },
  "\u5DF1": { pinyin: "J\u01D0", element: "Earth" },
  "\u5E9A": { pinyin: "G\u0113ng", element: "Metal" },
  "\u8F9B": { pinyin: "X\u012Bn", element: "Metal" },
  "\u58EC": { pinyin: "R\u00E9n", element: "Water" },
  "\u7678": { pinyin: "Gu\u01D0", element: "Water" },
};

export const ZODIAC_TRAITS: Record<string, {
  personality: string;
  strengths: string[];
  compatible: string[];
  incompatible: string[];
  lucky_numbers: number[];
  lucky_colors: string[];
}> = {
  Rat: {
    personality: "Quick-witted, resourceful, and versatile. Rats are clever and adaptable, with strong intuition and a keen eye for opportunity.",
    strengths: ["Intelligence", "Adaptability", "Charm", "Resourcefulness"],
    compatible: ["Dragon", "Monkey", "Ox"],
    incompatible: ["Horse", "Goat"],
    lucky_numbers: [2, 3],
    lucky_colors: ["blue", "gold", "green"],
  },
  Ox: {
    personality: "Diligent, dependable, and determined. The Ox is patient and methodical, building success through steady effort.",
    strengths: ["Reliability", "Patience", "Honesty", "Determination"],
    compatible: ["Rat", "Snake", "Rooster"],
    incompatible: ["Tiger", "Dragon", "Horse", "Goat"],
    lucky_numbers: [1, 4],
    lucky_colors: ["white", "yellow", "green"],
  },
  Tiger: {
    personality: "Brave, confident, and competitive. Tigers are natural leaders who inspire others with their courage and passion.",
    strengths: ["Courage", "Confidence", "Charisma", "Leadership"],
    compatible: ["Dragon", "Horse", "Pig"],
    incompatible: ["Ox", "Tiger", "Snake", "Monkey"],
    lucky_numbers: [1, 3, 4],
    lucky_colors: ["blue", "grey", "orange"],
  },
  Rabbit: {
    personality: "Gentle, quiet, and elegant. Rabbits are diplomatic and compassionate, with a refined artistic sensibility.",
    strengths: ["Gentleness", "Sensitivity", "Compassion", "Elegance"],
    compatible: ["Goat", "Monkey", "Dog", "Pig"],
    incompatible: ["Snake", "Rooster"],
    lucky_numbers: [3, 4, 6],
    lucky_colors: ["red", "pink", "purple", "blue"],
  },
  Dragon: {
    personality: "Confident, ambitious, and energetic. Dragons are charismatic visionaries who pursue their goals with fiery determination.",
    strengths: ["Ambition", "Energy", "Courage", "Charisma"],
    compatible: ["Rooster", "Rat", "Monkey"],
    incompatible: ["Ox", "Goat", "Dog"],
    lucky_numbers: [1, 6, 7],
    lucky_colors: ["gold", "silver", "grey"],
  },
  Snake: {
    personality: "Enigmatic, intelligent, and wise. Snakes are deep thinkers with strong intuition and a talent for seeing beneath the surface.",
    strengths: ["Wisdom", "Intelligence", "Intuition", "Elegance"],
    compatible: ["Dragon", "Rooster"],
    incompatible: ["Tiger", "Rabbit", "Snake", "Goat", "Pig"],
    lucky_numbers: [2, 8, 9],
    lucky_colors: ["black", "red", "yellow"],
  },
  Horse: {
    personality: "Energetic, free-spirited, and warm-hearted. Horses are independent adventurers with infectious enthusiasm.",
    strengths: ["Energy", "Independence", "Warmth", "Enthusiasm"],
    compatible: ["Tiger", "Goat", "Rabbit"],
    incompatible: ["Rat", "Ox", "Rooster"],
    lucky_numbers: [2, 3, 7],
    lucky_colors: ["brown", "yellow", "purple"],
  },
  Goat: {
    personality: "Calm, gentle, and sympathetic. Goats are creative souls with a deep appreciation for beauty and harmony.",
    strengths: ["Creativity", "Gentleness", "Sympathy", "Perseverance"],
    compatible: ["Rabbit", "Horse", "Pig"],
    incompatible: ["Ox", "Tiger", "Dog"],
    lucky_numbers: [2, 7],
    lucky_colors: ["brown", "red", "purple"],
  },
  Monkey: {
    personality: "Sharp, clever, and curious. Monkeys are inventive problem-solvers with a mischievous sense of humor.",
    strengths: ["Cleverness", "Curiosity", "Wit", "Versatility"],
    compatible: ["Ox", "Rabbit"],
    incompatible: ["Tiger", "Pig"],
    lucky_numbers: [4, 9],
    lucky_colors: ["white", "blue", "gold"],
  },
  Rooster: {
    personality: "Observant, hardworking, and courageous. Roosters are honest and detail-oriented, with strong convictions.",
    strengths: ["Honesty", "Diligence", "Communication", "Courage"],
    compatible: ["Ox", "Snake"],
    incompatible: ["Rat", "Rabbit", "Horse", "Rooster", "Dog"],
    lucky_numbers: [5, 7, 8],
    lucky_colors: ["gold", "brown", "yellow"],
  },
  Dog: {
    personality: "Loyal, honest, and amiable. Dogs are faithful companions who value justice and stand by those they love.",
    strengths: ["Loyalty", "Honesty", "Bravery", "Kindness"],
    compatible: ["Rabbit"],
    incompatible: ["Dragon", "Goat", "Rooster"],
    lucky_numbers: [3, 4, 9],
    lucky_colors: ["red", "green", "purple"],
  },
  Pig: {
    personality: "Compassionate, generous, and diligent. Pigs are warm-hearted optimists who enjoy life's pleasures and share freely.",
    strengths: ["Generosity", "Compassion", "Diligence", "Optimism"],
    compatible: ["Tiger", "Rabbit", "Goat"],
    incompatible: ["Snake", "Monkey"],
    lucky_numbers: [2, 5, 8],
    lucky_colors: ["yellow", "grey", "brown", "gold"],
  },
};

export const PHASE_NAMES = [
  { name: "New Moon", emoji: "\uD83C\uDF11", min: 0, max: 45 },
  { name: "Waxing Crescent", emoji: "\uD83C\uDF12", min: 45, max: 90 },
  { name: "First Quarter", emoji: "\uD83C\uDF13", min: 90, max: 135 },
  { name: "Waxing Gibbous", emoji: "\uD83C\uDF14", min: 135, max: 180 },
  { name: "Full Moon", emoji: "\uD83C\uDF15", min: 180, max: 225 },
  { name: "Waning Gibbous", emoji: "\uD83C\uDF16", min: 225, max: 270 },
  { name: "Third Quarter", emoji: "\uD83C\uDF17", min: 270, max: 315 },
  { name: "Waning Crescent", emoji: "\uD83C\uDF18", min: 315, max: 360 },
] as const;

export const QUARTER_NAMES = ["New Moon", "First Quarter", "Full Moon", "Third Quarter"] as const;
export const QUARTER_EMOJIS = ["\uD83C\uDF11", "\uD83C\uDF13", "\uD83C\uDF15", "\uD83C\uDF17"] as const;

export const ZODIAC_ANIMALS = [
  "Rat", "Ox", "Tiger", "Rabbit", "Dragon", "Snake",
  "Horse", "Goat", "Monkey", "Rooster", "Dog", "Pig",
] as const;

export const ZODIAC_ANIMAL_EMOJIS: Record<string, string> = {
  Rat: "\uD83D\uDC00", Ox: "\uD83D\uDC02", Tiger: "\uD83D\uDC05", Rabbit: "\uD83D\uDC07",
  Dragon: "\uD83D\uDC09", Snake: "\uD83D\uDC0D", Horse: "\uD83D\uDC0E", Goat: "\uD83D\uDC10",
  Monkey: "\uD83D\uDC12", Rooster: "\uD83D\uDC13", Dog: "\uD83D\uDC15", Pig: "\uD83D\uDC16",
};

export const ELEMENT_COLORS: Record<string, string> = {
  Wood: "#8b9a7d",   // sage
  Fire: "#9e4a3a",   // rust
  Earth: "#c9a86c",  // gold
  Metal: "#d4cfc4",  // cream
  Water: "#7c5db5",  // violet
};

export const SYNODIC_MONTH = 29.53059;
