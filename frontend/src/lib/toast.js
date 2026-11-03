// Tiny toast bus: toast('Saved') or toast(err.message, 'bad'). <Toaster/> in App renders them.
const listeners = new Set();
let nextId = 1;

export function toast(message, tone = 'good') {
  const t = { id: nextId++, message: String(message), tone };
  listeners.forEach((fn) => fn(t));
}

export const onToast = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
