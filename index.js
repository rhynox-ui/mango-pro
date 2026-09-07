/**
 * @format
 */

import './src/polyfills';
import { AppRegistry } from 'react-native';
import { installCrashReporter } from './src/debug/crashReporter';
import App from './App';
import { name as appName } from './app.json';

// As early as possible, before anything else can throw — see
// crashReporter.ts's own header for why this exists.
installCrashReporter();

AppRegistry.registerComponent(appName, () => App);
