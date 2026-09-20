import { describe, expect, it } from 'vitest';
import { pairingQrText, qrShape } from './qr';

describe('pairing QR', () => {
  const code = 'abcd-efgh-ijkl-mnop-qrst-uvwx-yz23-4567-abcd-efgh-ijkl-mnop-qrst-uvwx-yz23-4567-abcd-efg';

  it('drops the dashes and upper-cases the code', () => {
    expect(pairingQrText('abcd-ef23')).toBe('ABCDEF23');
  });

  it('draws a square code with the three finder corners', () => {
    const { size, path } = qrShape(pairingQrText(code));
    expect(size).toBeGreaterThanOrEqual(21);
    expect((size - 17) % 4).toBe(0);
    for (const corner of ['M0 0h', `M${size - 7} 0h`, `M0 ${size - 7}h`]) expect(path).toContain(corner);
  });

  it('is smaller than the same code written with dashes in lower case', () => {
    expect(qrShape(pairingQrText(code)).size).toBeLessThan(qrShape(code).size);
  });
});
