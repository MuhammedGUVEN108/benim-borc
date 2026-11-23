-- Defterin her sürümü ayrı satırdır. En büyük rev güncel durumdur.
-- rev birincil anahtar olduğundan aynı sürüme iki yazma çakışır (iyimser kilit).
CREATE TABLE IF NOT EXISTS versions (
  rev INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  at TEXT NOT NULL,
  source TEXT NOT NULL
);
