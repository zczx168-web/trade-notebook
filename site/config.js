// Public API base URL only. Merchant secrets belong on the payment server.
window.TRADE_CONFIG = Object.freeze({
  apiBase: '',
  checkoutOrigins: [],
  manualPayment: {
    merchant: '焦煤观察(**玲)',
    supportName: '焦煤观察',
    supportQr: 'assets/payments/wechat-support-qr.png',
    supportOriginal: 'assets/payments/wechat-support.jpg',
    plans: {
      month: { name: '月度会员', price: '19.90', duration: '30 天', qr: 'assets/payments/wechat-month-qr.png', original: 'assets/payments/wechat-month.jpg' },
      forever: { name: '永久会员', price: '199.00', duration: '永久', qr: 'assets/payments/wechat-forever-qr.png', original: 'assets/payments/wechat-forever.jpg' }
    }
  }
});
