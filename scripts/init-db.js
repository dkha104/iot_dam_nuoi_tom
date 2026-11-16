import {initializeDatabase} from '../src/database.js';
import {MongoClient} from 'mongodb';
const client=new MongoClient(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017',{serverSelectionTimeoutMS:6000});
try {await client.connect();await initializeDatabase(client.db(process.env.MONGODB_DB||'aotom'));console.log('Đã khởi tạo 19 collections, validators và indexes.');}
finally{await client.close();}
