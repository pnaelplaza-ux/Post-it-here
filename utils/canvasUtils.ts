import { NoteData, NoteColor, StampData, CursorData } from '../types';

// --- STAMPS ---
export const drawStamp = (
  ctx: CanvasRenderingContext2D,
  stamp: StampData
) => {
  ctx.save();
  ctx.translate(stamp.x, stamp.y);
  ctx.rotate((stamp.rotation * Math.PI) / 180);
  
  ctx.font = '40px "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Subtle shadow for depth
  ctx.shadowColor = 'rgba(0,0,0,0.1)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 2;
  
  ctx.fillText(stamp.emoji, 0, 0);
  
  ctx.restore();
};

// --- CURSORS ---
export const drawCursor = (
  ctx: CanvasRenderingContext2D,
  cursor: CursorData
) => {
  ctx.save();
  ctx.translate(cursor.x, cursor.y);
  
  // Draw Arrow
  ctx.fillStyle = cursor.color;
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(8, 24);
  ctx.lineTo(12, 18);
  ctx.lineTo(22, 28); // tail
  ctx.lineTo(26, 24); // tail width
  ctx.lineTo(16, 14);
  ctx.lineTo(24, 12);
  ctx.closePath();
  
  ctx.fill();
  ctx.stroke();

  // Draw Label (Optional ID)
  ctx.fillStyle = cursor.color;
  ctx.font = '10px sans-serif';
  ctx.fillText(cursor.id.slice(0, 6), 14, 30);

  ctx.restore();
};

// --- NOTES ---
export const drawNote = (
  ctx: CanvasRenderingContext2D,
  note: NoteData,
  isSelected: boolean
) => {
  ctx.save();
  ctx.translate(note.x, note.y);
  ctx.rotate((note.rotation * Math.PI) / 180);

  // Shadow
  ctx.shadowColor = 'rgba(0,0,0,0.15)';
  ctx.shadowBlur = isSelected ? 20 : 6;
  ctx.shadowOffsetX = isSelected ? 5 : 2;
  ctx.shadowOffsetY = isSelected ? 10 : 4;

  // Note Body
  const size = 240;
  const half = size / 2;
  
  ctx.fillStyle = note.color;
  
  // Draw a slightly imperfect square for realism
  ctx.beginPath();
  ctx.moveTo(-half, -half);
  ctx.lineTo(half, -half);
  ctx.lineTo(half, half - 20); // Dog ear start
  ctx.lineTo(half - 20, half); // Dog ear end
  ctx.lineTo(-half, half);
  ctx.closePath();
  ctx.fill();

  // Dog Ear Visual
  ctx.fillStyle = 'rgba(0,0,0,0.1)'; // Fold shadow
  ctx.beginPath();
  ctx.moveTo(half, half - 20);
  ctx.lineTo(half, half);
  ctx.lineTo(half - 20, half);
  ctx.fill();
  
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; // Fold highlight
  ctx.beginPath();
  ctx.moveTo(half, half - 20);
  ctx.lineTo(half - 20, half - 20);
  ctx.lineTo(half - 20, half);
  ctx.fill();

  // Reset shadow for text
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Text
  ctx.fillStyle = '#1f2937'; // gray-800
  ctx.font = '30px "Caveat", cursive';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  wrapText(ctx, note.text, 0, -20, size - 40, 32);

  // Tape (optional)
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.translate(0, -half + 5);
  ctx.rotate(-0.02);
  ctx.fillRect(-40, -10, 80, 20);

  ctx.restore();
};

const wrapText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) => {
  const words = text.split(' ');
  let line = '';
  const lines: string[] = [];

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    
    if (testWidth > maxWidth && n > 0) {
      lines.push(line);
      line = words[n] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line);

  // Center vertically based on number of lines
  const totalHeight = lines.length * lineHeight;
  let currentY = y - (totalHeight / 2) + (lineHeight / 2);

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, currentY);
    currentY += lineHeight;
  }
};
