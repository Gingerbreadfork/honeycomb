import qrcode from 'qrcode-generator';

export interface QrShape {
  /** Modules per side, without the quiet zone. */
  size: number;
  /** Every dark module as one SVG path, one unit per module. */
  path: string;
}

/** Upper case without dashes fits QR's compact alphanumeric mode, and the engine reads it the same. */
export function pairingQrText(code: string): string {
  return code.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

export function qrShape(text: string): QrShape {
  const qr = qrcode(0, 'M');
  qr.addData(text, /^[0-9A-Z $%*+\-./:]*$/.test(text) ? 'Alphanumeric' : 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  let path = '';
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  return { size, path };
}
