// Respaldo curado de los rieles de «Series y películas»: se sirve
// cuando Trakt no tiene llave configurada, falla o no hay copia en
// R2. Contenido editorial revisado por Luis; los imdbId se verifican
// contra OMDb con scripts/screen-curated-check.mjs — si un título
// falla la comprobación se corrige o se quita de esta lista.
//
// Solo metadatos públicos (id de IMDb, tipo, título, año): nada de
// sinopsis ni datos de usuarios. hasPoster se completa en el worker
// (los pósters salen por /api/screen/poster, que ya cachea en R2).

export type CuratedScreenEntry = {
  imdbId: string;
  type: "movie" | "tv";
  title: string;
  year: string;
};

export const CURATED_SCREEN: CuratedScreenEntry[] = [
  // Series
  { imdbId: "tt0108778", type: "tv", title: "Friends", year: "1994" },
  { imdbId: "tt0903747", type: "tv", title: "Breaking Bad", year: "2008" },
  { imdbId: "tt0386676", type: "tv", title: "The Office", year: "2005" },
  { imdbId: "tt4574334", type: "tv", title: "Stranger Things", year: "2016" },
  { imdbId: "tt0944947", type: "tv", title: "Game of Thrones", year: "2011" },
  { imdbId: "tt4786824", type: "tv", title: "The Crown", year: "2016" },
  { imdbId: "tt1475582", type: "tv", title: "Sherlock", year: "2010" },
  { imdbId: "tt1442437", type: "tv", title: "Modern Family", year: "2009" },
  {
    imdbId: "tt0460649",
    type: "tv",
    title: "How I Met Your Mother",
    year: "2005",
  },
  {
    imdbId: "tt0898266",
    type: "tv",
    title: "The Big Bang Theory",
    year: "2007",
  },
  { imdbId: "tt2085059", type: "tv", title: "Black Mirror", year: "2011" },
  { imdbId: "tt0096697", type: "tv", title: "The Simpsons", year: "1989" },
  // Películas
  { imdbId: "tt0133093", type: "movie", title: "The Matrix", year: "1999" },
  { imdbId: "tt0109830", type: "movie", title: "Forrest Gump", year: "1994" },
  {
    imdbId: "tt0111161",
    type: "movie",
    title: "The Shawshank Redemption",
    year: "1994",
  },
  { imdbId: "tt1375666", type: "movie", title: "Inception", year: "2010" },
  { imdbId: "tt0114709", type: "movie", title: "Toy Story", year: "1995" },
  { imdbId: "tt0266543", type: "movie", title: "Finding Nemo", year: "2003" },
  { imdbId: "tt0110357", type: "movie", title: "The Lion King", year: "1994" },
  { imdbId: "tt0120338", type: "movie", title: "Titanic", year: "1997" },
  { imdbId: "tt0816692", type: "movie", title: "Interstellar", year: "2014" },
  {
    imdbId: "tt1285016",
    type: "movie",
    title: "The Social Network",
    year: "2010",
  },
  {
    imdbId: "tt0088763",
    type: "movie",
    title: "Back to the Future",
    year: "1985",
  },
  { imdbId: "tt0468569", type: "movie", title: "The Dark Knight", year: "2008" },
  { imdbId: "tt2380307", type: "movie", title: "Coco", year: "2017" },
  { imdbId: "tt1049413", type: "movie", title: "Up", year: "2009" },
  { imdbId: "tt3783958", type: "movie", title: "La La Land", year: "2016" },
];
