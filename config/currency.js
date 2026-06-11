// Currency Configuration - South African Rand (Direct)
module.exports = {
  // Currency symbol
  CURRENCY_SYMBOL: 'R',
  
  // Currency code
  CURRENCY_CODE: 'ZAR',
  
  // Format Rand value for display
  formatRand: function(value) {
    return `R${value.toFixed(2)}`;
  }
};
