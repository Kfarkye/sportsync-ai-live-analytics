
import React, { useState, useEffect, useMemo } from 'react';

interface TypeWriterProps {
  lines: string[];
  colors?: string[];
  font?: 'sans' | 'mono';
  cursorChar?: 'pipe' | 'underscore' | 'block';
  typingSpeed?: number;
  deleteSpeed?: number;
  pauseBeforeType?: number;
  pauseBeforeDelete?: number;
  showCursor?: boolean;
  loop?: boolean;
  className?: string;
}

const TypeWriter: React.FC<TypeWriterProps> = ({
  lines,
  colors = [],
  font = 'sans',
  cursorChar = 'pipe',
  typingSpeed = 65,
  deleteSpeed = 40,
  pauseBeforeType = 600,
  pauseBeforeDelete = 2000,
  showCursor = true,
  loop = false,
  className = '',
}) => {
  const [displayText, setDisplayText] = useState('');
  const [lineIndex, setLineIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);

  // Mapping cursor types to characters
  const cursor = useMemo(() => {
    switch (cursorChar) {
      case 'underscore': return '_';
      case 'block': return '█';
      case 'pipe': default: return '|';
    }
  }, [cursorChar]);

  useEffect(() => {
    // Safety check for empty lines
    if (!lines || lines.length === 0) return;

    // Current target line text
    const currentLine = lines[lineIndex];
    
    // Determine timeout duration based on state
    let timeoutDuration = typingSpeed;
    
    if (isWaiting) {
      timeoutDuration = isDeleting ? pauseBeforeDelete : pauseBeforeType;
    } else if (isDeleting) {
      timeoutDuration = deleteSpeed;
    }

    const timer = setTimeout(() => {
      // 1. WAITING STATE (Pause before delete or next type)
      if (isWaiting) {
        setIsWaiting(false);
        if (!isDeleting && displayText === currentLine) {
          // Finished typing line, now delete (unless it's the last line and no loop)
          if (!loop && lineIndex === lines.length - 1) {
            return; // Stop here
          }
          setIsDeleting(true);
        } else if (isDeleting && displayText === '') {
          // Finished deleting, move to next line
          setIsDeleting(false);
          setLineIndex((prev) => (prev + 1) % lines.length);
        }
        return;
      }

      // 2. DELETING STATE
      if (isDeleting) {
        setDisplayText((prev) => prev.slice(0, -1));
        if (displayText.length <= 1) {
          setIsWaiting(true); // Pause before typing next
        }
      } 
      // 3. TYPING STATE
      else {
        setDisplayText((prev) => currentLine.slice(0, prev.length + 1));
        if (displayText.length === currentLine.length - 1) {
          setIsWaiting(true); // Pause before deleting
        }
      }
    }, timeoutDuration);

    return () => clearTimeout(timer);
  }, [
    displayText, 
    lineIndex, 
    isDeleting, 
    isWaiting, 
    lines, 
    loop, 
    typingSpeed, 
    deleteSpeed, 
    pauseBeforeType, 
    pauseBeforeDelete
  ]);

  // Determine current color
  const currentColor = colors[lineIndex % colors.length] || 'text-white';
  const fontFamily = font === 'mono' ? 'font-mono' : 'font-sans';

  return (
    <div className={`${fontFamily} ${className} inline-flex items-center`}>
      <span className={`${currentColor} transition-colors duration-300`}>
        {displayText}
      </span>
      {showCursor && (
        <span className={`ml-1 animate-pulse ${currentColor}`}>
          {cursor}
        </span>
      )}
    </div>
  );
};

export default TypeWriter;
