import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB-ay6gzKzVAARm-OhWEI99b-LgvOUveO8",
  authDomain: "betvibe.firebaseapp.com",
  projectId: "betvibe",
  storageBucket: "betvibe",
  messagingSenderId: "182386105033",
  appId: "1:182386105033:web:f46ddb4e3c3e75caf04b18",
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
