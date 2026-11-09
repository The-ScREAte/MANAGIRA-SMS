/* express-ejs-layouts 2.5.1, kept here with one change: parseContents returns at once when a
   page has no contentFor marker (see the comment there). Original licence:

   Copyright (c) 2012 Igor Soarez <igor@soarez.com>

   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

   The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/*jslint sloppy:true indent:2 plusplus:true regexp:true*/

var contentPattern = '&&<>&&';

function contentFor(contentName) {
  return contentPattern + contentName + contentPattern;
}

function parseContents(locals) {
  // Fast path: no page here uses contentFor, so most bodies have no marker at all, and the
  // two regular-expression passes below would scan every rendered page for nothing.
  if (typeof locals.body !== 'string' || locals.body.indexOf(contentPattern) === -1) return;
  var name, i = 1, str = locals.body,
    regex = new RegExp('\r?\n?' + contentPattern + '.+?' + contentPattern + '\r?\n?', 'g'),
    split = str.split(regex),
    matches = str.match(regex);

  locals.body = split[0];

  if (matches !== null) {
    matches.forEach(function (match) {
      name = match.split(contentPattern)[1];
      locals[name] = split[i];
      i++;
    });
  }
}

function parseScripts(locals) {
  var str = locals.body, regex = /\<script[\s\S]*?\>[\s\S]*?\<\/script\>/g;

  if (regex.test(str)) {
    locals.body = str.replace(regex, '');
    locals.script = str.match(regex).join('\n');
  }
}

function parseStyles(locals) {
  var str = locals.body, regex = /(?:\<style[\s\S]*?\>[\s\S]*?\<\/style\>)|(?:\<link[\s\S]*?\>(?:\<\/link\>)?)/g;

  if (regex.test(str)) {
    locals.body = str.replace(regex, '');
    locals.style = str.match(regex).join('\n');
  }
}

function parseMetas(locals) {
  var str = locals.body, regex = /\<meta[\s\S]*?\>/g;

  if (regex.test(str)) {
    locals.body = str.replace(regex, '');
    locals.meta = str.match(regex).join('\n');
  }
}

module.exports = function (req, res, next) {
  if(!res.__render) res.__render = res.render;

  res.render = function (view, options, fn) {
    var layout, self = this, app = req.app,
      defaultLayout = app.get('layout');

    options = options || {};
    if (typeof options === 'function') {
      fn = options;
      options = {};
    }

    if (options.layout === false || ((options.layout || defaultLayout) === false)) {
      res.__render.call(res, view, options, fn);
      return;
    }

    layout = options.layout || res.locals.layout || defaultLayout;
    if (layout === true || layout === undefined) {
      layout = 'layout';
    }

    options.contentFor = contentFor;
    res.__render.call(res, view, options, function (err, str) {
      var l, locals;

      if (err) { return fn ? fn(err) : next(err); }

      locals = {
        body: str,
        defineContent: function(contentName) { return locals[contentName] || ''; }
      };
      for (l in options) {
        if (options.hasOwnProperty(l) && l !== 'layout' && l !== 'contentFor') {
          locals[l] = options[l];
        }
      }

      if (typeof locals.body !== 'string') {
        res.__render.call(self, view, locals, fn);
        return;
      }

      if (options.extractScripts === true || (options.extractScripts === undefined && app.get('layout extractScripts') === true)) {
        locals.script = '';
        parseScripts(locals);
      }

      if (options.extractStyles === true || (options.extractStyles === undefined && app.get('layout extractStyles') === true)) {
        locals.style = '';
        parseStyles(locals);
      }

      if (options.extractMetas === true || (options.extractMetas === undefined && app.get('layout extractMetas') === true)) {
        locals.meta = '';
        parseMetas(locals);
      }

      parseContents(locals);
      res.__render.call(self, layout, locals, fn);
    });
  };
  next();
};
