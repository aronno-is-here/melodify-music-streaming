/**
 * In-memory model doubles for the friend-request / notification route tests.
 *
 * The doubles mirror only the query shapes used by `friendRoutes`,
 * `notificationRoutes`, `likeRoutes`, `commentRoutes`, and `postRoutes` so the
 * route handlers can be exercised without MongoDB.
 */

export function createRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

export function getRouteHandler(router, path, method) {
  const layer = router.stack.find(
    (entry) => entry.route && entry.route.path === path && entry.route.methods[method]
  );
  if (!layer) {
    throw new Error(`Missing route ${method.toUpperCase()} ${path}`);
  }
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

export function chain(value) {
  const api = {
    sort: () => api,
    skip: () => api,
    limit: () => api,
    populate: () => api,
    select: () => api,
    lean: () => api,
    then: (onFulfilled, onRejected) =>
      Promise.resolve(typeof value === 'function' ? value() : value).then(onFulfilled, onRejected),
  };
  return api;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function matches(doc, query = {}) {
  for (const [key, condition] of Object.entries(query)) {
    if (key === '$or') {
      if (!condition.some((sub) => matches(doc, sub))) return false;
      continue;
    }
    if (isPlainObject(condition)) {
      if ('$ne' in condition && String(doc[key]) === String(condition.$ne)) return false;
      if ('$in' in condition && !condition.$in.some((value) => String(doc[key]) === String(value))) {
        return false;
      }
      if ('$regex' in condition) {
        let pattern;
        try {
          pattern = new RegExp(condition.$regex, condition.$options || '');
        } catch {
          return false;
        }
        if (!pattern.test(String(doc[key] === undefined || doc[key] === null ? '' : doc[key]))) return false;
      }
      continue;
    }
    if (doc[key] === undefined || String(doc[key]) !== String(condition)) return false;
  }
  return true;
}

function compareSort(a, b, sortSpec) {
  for (const [key, direction] of Object.entries(sortSpec)) {
    const left = a[key] instanceof Date ? a[key].getTime() : a[key];
    const right = b[key] instanceof Date ? b[key].getTime() : b[key];
    if (left === right) continue;
    if (left === undefined || left === null) return direction;
    if (right === undefined || right === null) return -direction;
    return left < right ? -1 * direction : 1 * direction;
  }
  return 0;
}

function applyUpdate(target, update) {
  const { $set, $inc, ...direct } = update;
  Object.assign(target, direct);
  if ($set) Object.assign(target, $set);
  if ($inc) {
    for (const [field, delta] of Object.entries($inc)) {
      target[field] = (Number(target[field]) || 0) + delta;
    }
  }
}

export function createCollection({
  uniqueKeys = [],
  idPrefix = 'a'.repeat(16),
  sortSpec = { createdAt: -1, _id: -1 },
  populateRef = null,
} = {}) {
  let counter = 0;
  const docs = [];

  const nextId = () => `${idPrefix}${String(counter++).padStart(8, '0')}`;

  const hydrate = (raw) => {
    const view = { ...raw };
    Object.defineProperty(view, 'save', {
      enumerable: false,
      value: async function save() {
        const target = docs.find((entry) => String(entry._id) === String(raw._id));
        if (target) {
          for (const key of Object.keys(raw)) {
            if (key === 'save') continue;
            target[key] = view[key];
          }
          target.updatedAt = new Date();
        }
        return view;
      },
    });
    return view;
  };

  const assertUnique = (candidate) => {
    for (const keys of uniqueKeys) {
      if (!keys.every((key) => candidate[key] !== undefined && candidate[key] !== null)) continue;
      const clash = docs.some((doc) => keys.every((key) => String(doc[key]) === String(candidate[key])));
      if (clash) {
        const error = new Error(`E11000 duplicate key: ${keys.join('+')}`);
        error.code = 11000;
        throw error;
      }
    }
  };

  return {
    _docs: docs,
    findOne(query = {}) {
      return chain(() => {
        const found = docs.find((doc) => matches(doc, query));
        return found ? hydrate({ ...found }) : null;
      });
    },
    findById(id) {
      return chain(() => {
        const found = docs.find((doc) => String(doc._id) === String(id));
        return found ? hydrate({ ...found }) : null;
      });
    },
    find(query = {}) {
      let cursor = docs.filter((doc) => matches(doc, query));
      const api = {
        sort(spec) {
          cursor = [...cursor].sort((a, b) => compareSort(a, b, spec));
          return api;
        },
        skip(count) {
          cursor = cursor.slice(count);
          return api;
        },
        limit(count) {
          cursor = cursor.slice(0, count);
          return api;
        },
        populate(path) {
          if (typeof populateRef === 'function') {
            cursor = cursor.map((doc) => {
              const ref = doc[path];
              if (ref === null || ref === undefined || typeof ref === 'object') return doc;
              const target = populateRef(ref);
              return target ? { ...doc, [path]: target } : doc;
            });
          }
          return api;
        },
        select() {
          return api;
        },
        then: (onFulfilled, onRejected) =>
          Promise.resolve(cursor.map((doc) => hydrate({ ...doc }))).then(onFulfilled, onRejected),
      };
      return api;
    },
    async create(data) {
      const record = {
        _id: data._id || nextId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        read: false,
        ...data,
      };
      assertUnique(record);
      docs.push(record);
      return hydrate({ ...record });
    },
    findByIdAndUpdate(id, update) {
      return chain(() => {
        const target = docs.find((doc) => String(doc._id) === String(id));
        if (!target) return null;
        applyUpdate(target, update);
        return hydrate({ ...target });
      });
    },
    async findOneAndDelete(query = {}) {
      const index = docs.findIndex((doc) => matches(doc, query));
      if (index === -1) return null;
      const [removed] = docs.splice(index, 1);
      return hydrate({ ...removed });
    },
    async updateMany(query, update) {
      const targets = docs.filter((doc) => matches(doc, query));
      for (const target of targets) applyUpdate(target, update);
      return { matchedCount: targets.length, modifiedCount: targets.length };
    },
    async deleteMany(query) {
      const keep = [];
      let deletedCount = 0;
      for (const doc of docs) {
        if (matches(doc, query)) deletedCount += 1;
        else keep.push(doc);
      }
      docs.splice(0, docs.length, ...keep);
      return { deletedCount };
    },
    async countDocuments(query = {}) {
      return docs.filter((doc) => matches(doc, query)).length;
    },
  };
}

export function installModelDoubles(models, collections) {
  const originals = new Map();
  const methods = [
    'findOne',
    'findById',
    'find',
    'create',
    'findByIdAndUpdate',
    'findOneAndDelete',
    'updateMany',
    'deleteMany',
    'countDocuments',
  ];

  for (const [model, collection] of Object.entries(collections)) {
    const target = models[model];
    originals.set(model, {});
    for (const method of methods) {
      if (typeof target[method] !== 'function') continue;
      originals.get(model)[method] = target[method];
      target[method] = collection[method].bind(collection);
    }
  }

  return () => {
    for (const [model, methodsByModel] of originals.entries()) {
      const target = models[model];
      for (const [method, original] of Object.entries(methodsByModel)) {
        target[method] = original;
      }
    }
  };
}
