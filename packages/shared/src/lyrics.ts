export interface LyricWord {
  t: string
  start: number
  end: number
}

export interface LyricLine {
  start: number
  end: number
  words: LyricWord[]
}

export interface LyricsDoc {
  lines: LyricLine[]
}
