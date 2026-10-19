// Captures the source of the script APTV injects to drive its knob (it runs in
// this page's world and scans the page with querySelectorAll). A classic,
// non-strict script on purpose: only here can a wrapper read `.caller`.
(function () {
  var seen = {};
  var sources = [];
  var timer = 0;

  function grab(wrapper, what) {
    var fn = wrapper.caller;
    for (var depth = 0; fn && depth < 6; depth++) {
      var text;
      try {
        text = Function.prototype.toString.call(fn);
      } catch (e) {
        text = '[unreadable: ' + e.message + ']';
      }
      var key = text.length + ':' + text.slice(0, 120);
      if (!seen[key]) {
        seen[key] = true;
        sources.push({ via: what, depth: depth, source: text.slice(0, 20000) });
      }
      try {
        fn = fn.caller;
      } catch (e) {
        break;
      }
    }
    var stack = (new Error().stack || '').split('\n').slice(1, 8).join('\n');
    if (!seen[stack]) {
      seen[stack] = true;
      sources.push({ via: what, stack: stack });
    }
    clearTimeout(timer);
    timer = setTimeout(send, 3000);
  }

  function send() {
    var base = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'http://127.0.0.1:8787'
      : 'https://carplay-tube.carplay-tube-worker.workers.dev';
    try {
      fetch(base + '/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: 'sniff' + Date.now().toString(36).slice(-6), sniff: sources, ua: navigator.userAgent, at: new Date().toISOString() }),
      });
    } catch (e) {
      // Nothing to do: diagnostics only.
    }
  }

  function wrap(proto, name, label) {
    var original = proto[name];
    if (typeof original !== 'function') return;
    var wrapper = function () {
      // Our own modules and YouTube's API leave a URL in the stack; injected script does not.
      var stack = new Error().stack || '';
      if (!/https?:\/\//.test(stack.split('\n').slice(1).join('\n'))) grab(wrapper, label + '(' + String(arguments[0]).slice(0, 40) + ')');
      return original.apply(this, arguments);
    };
    proto[name] = wrapper;
  }

  wrap(Document.prototype, 'querySelectorAll', 'querySelectorAll');
  wrap(Element.prototype, 'querySelectorAll', 'el.querySelectorAll');
  wrap(Element.prototype, 'getBoundingClientRect', 'getBoundingClientRect');
  wrap(HTMLElement.prototype, 'click', 'click');
  wrap(Element.prototype, 'setAttribute', 'setAttribute');
  wrap(CSSStyleDeclaration.prototype, 'setProperty', 'style.setProperty');
})();
