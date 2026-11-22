export default function LeafBackdrop() {
  return <div className="leaf-backdrop" aria-hidden="true">
    {Array.from({ length: 24 }, (_, i) => {
      const seconds = 30 + (i * 7) % 19;
      return <span key={i} style={{
        top: `${2 + (i * 37) % 95}%`,
        width: `${12 + (i * 11) % 19}px`,
        animationDuration: `${seconds}s`,
        animationDelay: `-${seconds * ((i * 7) % 24) / 24}s`,
        '--flutter': `${4 + i % 4}s`,
      }} />;
    })}
  </div>;
}
