export class PrinterManager {
  static async printReceipt(orderId, cart, total, openDrawer = true, tendered = 0, settings = {}) {
    let cmds = [0x1B, 0x40]; // Init
    
    // Header
    cmds.push(0x1B, 0x61, 0x01); // Center align
    cmds.push(0x1B, 0x45, 0x01); // Bold ON
    const encoder = new TextEncoder();
    cmds.push(...encoder.encode(`${settings.shop_name || 'SUPER GROCERY'}\n`));
    cmds.push(0x1B, 0x45, 0x00); // Bold OFF
    cmds.push(...encoder.encode(`${settings.shop_address || 'Main Street, Polonnaruwa'}\n`));
    cmds.push(...encoder.encode(`Tel: ${settings.shop_phone || '077 123 4567'}\n`));
    cmds.push(...encoder.encode("--------------------------------\n"));
    
    // Meta Info (Left align)
    cmds.push(0x1B, 0x61, 0x00); 
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].substring(0, 5);
    cmds.push(...encoder.encode(`Date: ${dateStr}  Time: ${timeStr}\n`));
    cmds.push(...encoder.encode(`Bill No: ${orderId}\n`));
    cmds.push(...encoder.encode(`Cashier: Admin\n`));
    cmds.push(...encoder.encode("--------------------------------\n"));
    
    // Table Header
    cmds.push(...encoder.encode("Item                Qty    Total\n"));
    cmds.push(...encoder.encode("--------------------------------\n"));
    
    // Items
    cart.forEach(item => {
      // Line 1: Item Name
      cmds.push(...encoder.encode(`${item.name}\n`));
      
      // Line 2: Price, Qty, Total
      const priceLKR = item.price_cents / 100;
      const totalLKR = priceLKR * item.quantity;
      
      const priceStr = priceLKR.toFixed(2).padEnd(16, ' ');
      const qtyStr = item.quantity.toString().padEnd(4, ' ');
      const totalStr = totalLKR.toFixed(2).padStart(12, ' ');
      
      cmds.push(...encoder.encode(`${priceStr}${qtyStr}${totalStr}\n`));
    });
    
    cmds.push(...encoder.encode("--------------------------------\n"));
    
    // Totals
    const subtotalStr = total.toFixed(2).padStart(11, ' ');
    cmds.push(...encoder.encode(`Subtotal (LKR):      ${subtotalStr}\n`));
    
    cmds.push(0x1B, 0x45, 0x01); // Bold ON
    cmds.push(...encoder.encode(`TOTAL (LKR):         ${subtotalStr}\n`));
    cmds.push(0x1B, 0x45, 0x00); // Bold OFF
    cmds.push(...encoder.encode("--------------------------------\n"));
    
    // Tender info (if cash payment)
    if (tendered > 0) {
      const change = tendered - total;
      const tenderedStr = tendered.toFixed(2).padStart(11, ' ');
      const changeStr = change.toFixed(2).padStart(11, ' ');
      cmds.push(...encoder.encode(`Cash Tendered:       ${tenderedStr}\n`));
      cmds.push(...encoder.encode(`Change:              ${changeStr}\n`));
      cmds.push(...encoder.encode("--------------------------------\n"));
    }
    
    // Footer
    cmds.push(0x1B, 0x61, 0x01); // Center align
    cmds.push(...encoder.encode("\nThank You!\nCome Again...\n"));
    
    // Feed 3 lines
    cmds.push(0x1B, 0x64, 0x03); 
    
    // The "Golden Sequence": Simultaneous Trigger (Drawer Kick + Paper Cut)
    if (openDrawer) {
      cmds.push(0x1B, 0x70, 0x00, 0x19, 0xFA); // ESC p 0 25 250
    }
    cmds.push(0x1D, 0x56, 0x42, 0x00); // GS V 66 0
    
    const buffer = new Uint8Array(cmds);
    
    // --- Mock Preview for Console ---
    const textPreview = Array.from(buffer)
      .filter(b => b >= 32 || b === 10) // Keep printable chars and newlines
      .map(b => String.fromCharCode(b))
      .join('');
      
    console.log("%c--- PRINTER RECEIPT PREVIEW ---\n\n" + textPreview + "\n-------------------------------", "font-family: monospace; background: #1e1e1e; color: #00e676; padding: 20px; border-radius: 8px; font-size: 14px;");
    
    console.log("SENDING TO PRINTER (Uint8Array):", buffer);
    return buffer;
  }
  
  static async openDrawer() {
    let cmds = [0x1B, 0x40]; // Init
    cmds.push(0x1B, 0x70, 0x00, 0x19, 0xFA); // ESC p 0 25 250
    const buffer = new Uint8Array(cmds);
    console.log("KICKING CASH DRAWER:", buffer);
    return buffer;
  }
}
