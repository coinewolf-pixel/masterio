// Metro для monorepo: Expo сам находит корень workspace и общий пакет @masterio/shared.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
