import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Get Firestore instance - safely handle optional firestoreDatabaseId
const dbInstance = (() => {
  try {
    // If firestoreDatabaseId is present in config, use it; otherwise use default
    if (firebaseConfig.firestoreDatabaseId) {
      return getFirestore(app, firebaseConfig.firestoreDatabaseId);
    }
    return getFirestore(app);
  } catch (error) {
    console.warn("[Firebase] Using default Firestore instance:", error);
    return getFirestore(app);
  }
})();

export const db = dbInstance;
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("[Firebase] Client is offline. Check your network connection.");
    }
    // Silently ignore other errors (test doc may not exist)
  }
}
testConnection();
