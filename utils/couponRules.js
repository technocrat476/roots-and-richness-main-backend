export const COUPON_RULES = [
  {
    id: '1',
    code: 'FLAT100',
    type: 'flat',
    value: 100,
    minOrderValue: 499,
    expiryDate: '2025-09-30',
    isActive: true,
    description: '₹100 OFF on orders above ₹499'
  },
  {
    id: '2',
    code: 'FIRST5',
    type: 'percent',
    value: 5,
    minOrderValue: 299,
    expiryDate: '2025-12-18',
    isActive: true,
    description: '5% OFF on orders above ₹299'
  },
  {
    id: '3',
    code: 'FREESHIP',
    type: 'flat',
    value: 75,
    minOrderValue: 699,
    expiryDate: '2025-05-15',
    isActive: true,
    description: '₹75 OFF (Free Shipping) on orders above ₹699'
  }
];
