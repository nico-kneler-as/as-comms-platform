/**
 * Field notes — curated nature/field-research quotes rotated daily on the
 * inbox welcome screen. Pure FE constant; no I/O.
 *
 * Selection: `today.getDate() % FIELD_QUOTES.length`. Refresh button cycles
 * deterministically through the list.
 */

export interface FieldQuote {
  readonly text: string;
  readonly author: string;
}

export const FIELD_QUOTES: readonly FieldQuote[] = [
  {
    text: "In every walk with nature, one receives far more than they seek.",
    author: "John Muir",
  },
  {
    text: "The clearest way into the universe is through a forest wilderness.",
    author: "John Muir",
  },
  {
    text: "What we are doing to the forests of the world is but a mirror reflection of what we are doing to ourselves.",
    author: "Mahatma Gandhi",
  },
  {
    text: "We can never have enough of nature.",
    author: "Henry David Thoreau",
  },
  {
    text: "There is pleasure in the pathless woods, there is rapture on the lonely shore.",
    author: "Lord Byron",
  },
  {
    text: "Wilderness is not a luxury but a necessity of the human spirit.",
    author: "Edward Abbey",
  },
  {
    text: "The best time to plant a tree was twenty years ago. The second best time is now.",
    author: "Chinese Proverb",
  },
  {
    text: "I felt my lungs inflate with the onrush of scenery — air, mountains, trees, people.",
    author: "Sylvia Plath",
  },
  {
    text: "The mountains are calling and I must go.",
    author: "John Muir",
  },
  {
    text: "Look deep into nature, and then you will understand everything better.",
    author: "Albert Einstein",
  },
  {
    text: "Nature does not hurry, yet everything is accomplished.",
    author: "Lao Tzu",
  },
  {
    text: "The earth has music for those who listen.",
    author: "George Santayana",
  },
  {
    text: "To find the universal elements enough; to find the air and the water exhilarating.",
    author: "John Burroughs",
  },
  {
    text: "Adopt the pace of nature: her secret is patience.",
    author: "Ralph Waldo Emerson",
  },
  {
    text: "In nature, nothing is perfect and everything is perfect.",
    author: "Alice Walker",
  },
  {
    text: "The forest makes your heart gentle. You become one with it. No place for greed or anger there.",
    author: "Pha Pachak",
  },
  {
    text: "Heaven is under our feet as well as over our heads.",
    author: "Henry David Thoreau",
  },
  {
    text: "Time spent among trees is never time wasted.",
    author: "Anonymous",
  },
  {
    text: "If you truly love nature, you will find beauty everywhere.",
    author: "Vincent van Gogh",
  },
  {
    text: "Just living is not enough. One must have sunshine, freedom, and a little flower.",
    author: "Hans Christian Andersen",
  },
  {
    text: "Climb the mountains and get their good tidings. Nature's peace will flow into you as sunshine flows into trees.",
    author: "John Muir",
  },
  {
    text: "Conservation is a state of harmony between men and land.",
    author: "Aldo Leopold",
  },
];
