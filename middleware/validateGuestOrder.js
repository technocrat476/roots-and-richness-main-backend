// middlewares/validateGuestOrder.js
import { body } from 'express-validator';
import { handleValidationErrors } from './validation.js';
export const validateGuestOrder = [
  body('orderItems')
    .isArray({ min: 1 })
    .withMessage('At least one item is required'),

  body('total')
    .isFloat({ min: 0 })
    .withMessage('Total must be a valid number'),

  body('subtotal')
    .isFloat({ min: 0 })
    .withMessage('Subtotal must be a valid number'),

  body('paymentProvider')
    .isIn(['cod', 'stripe', 'razorpay'])
    .withMessage('Invalid payment provider'),

  body('customerInfo.firstName')
    .trim()
    .notEmpty()
    .withMessage('First name is required'),

  body('customerInfo.lastName')
    .trim()
    .notEmpty()
    .withMessage('Last name is required'),

  body('customerInfo.email')
    .isEmail()
    .withMessage('Valid email is required'),

  body('customerInfo.phone')
    .matches(/^\d{10}$/)
    .withMessage('Phone must be 10 digits'),

  body('customerInfo.address')
    .notEmpty()
    .withMessage('Address is required'),

  body('customerInfo.city')
    .notEmpty()
    .withMessage('City is required'),

  body('customerInfo.state')
    .notEmpty()
    .withMessage('State is required'),

  body('customerInfo.pincode')
    .matches(/^\d{6}$/)
    .withMessage('Pincode must be 6 digits'),

  handleValidationErrors
];
