export const scrollToRef = (ref, options = {}) => {
  const {
    delay = 120,
    behavior = 'smooth',
    block = 'start'
  } = options;

  return setTimeout(() => {
    ref?.current?.scrollIntoView({ behavior, block });
  }, delay);
};

export const blurActiveInput = () => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') {
    document.activeElement.blur();
  }
};

export const mobileFieldFocusScroll = (event, options = {}) => {
  const { behavior = 'smooth', block = 'center' } = options;
  if (window.innerWidth < 768) {
    event.target.scrollIntoView({ behavior, block });
  }
};
