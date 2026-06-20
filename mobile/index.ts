import { registerRootComponent } from 'expo'
import App from './src/App'

// Expo's entry shim — registers App as the root component for both the
// native runner and Expo Go / dev-client.
registerRootComponent(App)
