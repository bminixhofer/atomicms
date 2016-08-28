'use strict';

const decb = require('decb');
const fs = decb(require('fs'), {
  use: ['readFile']
});
const cheerio = require('cheerio');
const root = require('app-root-path').path + '/';
const keva = require('keva');
const merge = require('merge');

let modules = {
  'content': []
};

let opt = {
  key: 'key.json',
  folders: {
    organism: 'templates/organisms',
    molecule: 'templates/molecules',
    atom: 'templates/atoms'
  },
  content: 'content',
  pages: 'templates/pages',
  attributes: {
    name: 'name',
    type: 'type',
    content: 'content'
  }
};

function renderFile(templatePath, contentPath) {
  templatePath = `${root}${opt.pages}/${templatePath}`;
  contentPath = `${root}${opt.content}/${contentPath}`;
  return Promise.all([
    fs.readFile(templatePath, 'utf8'),
    fs.readFile(contentPath, 'utf8')
  ]).then(values => {
    let [template, content] = values;
    return resolveElements(template, JSON.parse(content));
  });
}

function createTemplates() {
  let keyPath = `${root}${opt.key}`;
  return fs.readFile(keyPath, 'utf8').then(JSON.parse).then(keyJson => {
    let promises = [];
    for (let [key, value] of keva(keyJson)) {
      if (typeof value === 'string') {
        value = {
          template: value + '.html',
          content: value + '.json'
        };
      }
      promises.push(renderFile(value.template, value.content)
      .then(template => {
        return {key: key, template: template};
      }));
    }

    return Promise.all(promises).then(rendered => {
      let templates = {};
      rendered.forEach(render => {
        templates[render.key] = render.template;
      });
      return templates;
    });
  });
}

function resolveElements (template, content, depth = 0) {
  let $ = cheerio.load(template, {
    xmlMode: true
  });
  template = insertContent(content, $);

  if(depth > Object.keys(opt.folders).length - 1) {
    return template;
  }

  let promises = [];
  let level = Object.keys(opt.folders)[depth];

  $(level).each((_, elem) => {
    let name = $(elem).attr(`${opt.attributes.name}`);
    let type = $(elem).attr(`${opt.attributes.type}`);
    let currentContent = content[name || type];

    for (let [name, value] of keva(elem.attribs)) {
      let match = name.match(new RegExp(`^cms-(\w+)`));
      if (match) currentContent[match[1]] = value;
    }

    promises.push(
      fs.readFile(`${root}/${opt.folders[level]}/${type}.html`, 'utf8')
      .then(template => {
        return resolveElements(template, currentContent, depth + 1);
      }).then(html => ({node: elem, html: html})));
  });

  return Promise.all(promises).then(data => {
    data.forEach(elem => {
      $(elem.node).replaceWith(elem.html);
    });
    return $.html();
  });
}

function insertContent (data, $) {
  $('*').each((_, elem) => {
    for (let [name, value] of keva(elem.attribs)) {
      let match = name.match(/^cms-(\w+)/);
      let toInsert = typeof data === 'string' ? data : data[value];
      if (match) {
        $(elem).removeAttr(name);
        if (match[1] === opt.attributes.content) {
          let html = toInsert;
          html = applyModules(html, 'content');
          $(elem).html(html);
        } else {
          $(elem).attr(match[1], toInsert);
        }
      }
    }
  });

  return $.html();
}

function applyModules (target, name) {
  if (modules[name].length > 0) {
    return modules[name].reduce((a, b) => {
      return b(a);
    }, target);
  }
  return target;
}

module.exports = {
  modules: modules,
  setOptions: function(opts = {}) {
    opt = merge.recursive(opt, opt);
  },
  render: function() {
    return createTemplates().then(templates => {
      this.templates = templates;
      return (req, res, next) => {
        let target = this.templates[req.url];
        if (target) {
          res.send(target);
        } else {
          next();
        }
      }
    });
  },
  addModule: function () {
    let target;
    let module;
    if (typeof arguments[0] === 'object') {
      target = arguments[0].target;
      module = arguments[0].module;
    } else {
      target = arguments[0];
      module = arguments[1];
    }

    if (!modules[target]) throw new Error('Event does not exist.');
    if (typeof module !== 'function') throw new Error('Not a function.');
    modules[target].push(module);
  }
}