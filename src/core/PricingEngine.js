export class PricingEngine {
    constructor(vatRate = 18) {
        this.vatPercentage = vatRate;
    }

    /**
     * Calculates the subtotal, VAT, and final payable using integer cents 
     * to avoid JavaScript floating point errors (e.g. 0.1 + 0.2 = 0.300000004)
     * 
     * @param {Array} cartItems 
     * @param {number} billDiscount 
     * @returns {Object} { subTotal, vatAmount, finalPayable }
     */
    calculateTotal(cartItems, billDiscountCents = 0) {
        let subTotalCents = 0;
        let totalVatAmountCents = 0;

        cartItems.forEach(item => {
            const priceCents = item.price_cents;
            const qty = item.isWeightBased ? item.actualWeight : item.quantity;
            const lineSubtotalCents = Math.round(priceCents * qty);
            const itemDiscountCents = item.discountCents || 0;
            
            const itemNetCents = lineSubtotalCents - itemDiscountCents;
            subTotalCents += itemNetCents;
            
            // Check tax class (e.g., 'VAT18', 'VAT15')
            if (item.tax_class && item.tax_class.startsWith('VAT')) {
                const rate = parseInt(item.tax_class.replace('VAT', '')) || 18;
                totalVatAmountCents += Math.round((itemNetCents * rate) / 100);
            }
        });

        // Apply bill-level discount proportionally to taxable base (simplified for now)
        // If billDiscountCents is applied, we'd need to reduce VAT proportionally. 
        // For standard POS without complex proportional logic, we just subtract it from the final total.
        const finalPayableCents = subTotalCents + totalVatAmountCents - billDiscountCents;

        return {
            subTotalCents: subTotalCents, // Pre-bill-discount subtotal
            vatAmountCents: totalVatAmountCents,
            finalPayableCents: finalPayableCents,
            finalVatableTotalCents: subTotalCents // Simplified
        };
    }
}
