import { useEffect, useState } from 'react';
import { HexGrid } from '@ui/HexGrid';

function App() {
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return <HexGrid width={dimensions.width} height={dimensions.height} />;
}

export default App;
