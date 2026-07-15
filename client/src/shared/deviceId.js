/**
 * Stable per-install device identifier, used for the new-device login check
 * (an existing user signing in from an unknown device must confirm via
 * phone OTP). Generated once and kept in localStorage — which in the native
 * shell persists per app install.
 */
export default function getDeviceId() {
  try {
    let id = localStorage.getItem('sebenza_device_id');
    if (!id) {
      id = (window.crypto?.randomUUID?.() ||
        'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
      localStorage.setItem('sebenza_device_id', id);
    }
    return id;
  } catch (e) {
    return 'dev-unknown';
  }
}
