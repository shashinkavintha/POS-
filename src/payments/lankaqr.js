// CRC-16/CCITT-FALSE Implementation
// Polynomial: 0x1021, Initial: 0xFFFF
function calculateCRC16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) > 0) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
    }
  }
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

export class LankaQR {
  /**
   * Calculates MDR based on CBSL 2026 regulations
   * @param {number} amount
   * @param {string} walletOrigin 'DOMESTIC' | 'INTERNATIONAL'
   */
  static getMDRFee(amount, walletOrigin = 'DOMESTIC') {
    if (amount <= 5000) return 0.00; // Zero-fee micro-transactions
    const rate = (walletOrigin === 'DOMESTIC') ? 0.010 : 0.018;
    return amount * rate;
  }

  /**
   * Programmatically generates a LankaQR V1.3 Dynamic Payload
   * @param {number} amount 
   * @param {string} invoiceRef 
   * @param {Object} config 
   */
  static generateLankaQR(amount, invoiceRef, config = {
    guid: '000211',
    credentials: '010812345678', // MID etc
    merchantName: 'SUPER GROCERY',
    merchantCity: 'COLOMBO'
  }) {
    const serializeTLV = (tag, value) => {
      const t = tag.toString().padStart(2, '0');
      const v = value.toString();
      const l = v.length.toString().padStart(2, '0');
      return t + l + v;
    };

    // Sub-tags for Tag 26 (Merchant Account Information)
    const merchantInfo = serializeTLV(0, config.guid) + config.credentials;
    
    // Sub-tags for Tag 62 (Additional Data)
    const additionalData = serializeTLV(5, invoiceRef);

    let payload = "";
    payload += serializeTLV(0, "01"); // Payload Format
    payload += serializeTLV(1, "12"); // Point of Initiation: Dynamic
    payload += serializeTLV(26, merchantInfo); // Nested Merchant Info
    payload += serializeTLV(52, "5411"); // MCC
    payload += serializeTLV(53, "144"); // Currency: LKR
    payload += serializeTLV(54, amount.toFixed(2)); // Amount as string
    payload += serializeTLV(58, "LK"); // Country
    payload += serializeTLV(59, config.merchantName);
    payload += serializeTLV(60, config.merchantCity);
    payload += serializeTLV(62, additionalData); // Nested Ref ID

    // CRC-16 Preparation (Tag 63 with length 04)
    payload += "6304";
    const checksum = calculateCRC16(payload);
    return payload + checksum;
  }
}
