import expressApp from '../server/server.js';

export default function handler(req, res) {
  return expressApp(req, res);
}

export const config = {
  api: {
    bodyParser: false,
  },
};
