// Encabezado de capítulo in-documento del lector. Extraído de ReaderContent
// (B6 del plan de refactor) para que la animación/aria futura no toque el
// orquestador ni el contenido principal.
type ReaderChapterHeaderProps = {
  title: string;
  visible: boolean;
};

export default function ReaderChapterHeader({
  title,
  visible,
}: ReaderChapterHeaderProps) {
  if (!visible) return null;
  return <h1 className="chapter-title">{title}</h1>;
}