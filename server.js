'use strict';
// Node.js 22.13+; no Python or third-party packages required.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const root = __dirname;
const db = new DatabaseSync(path.join(root, 'seato.db'));
db.exec('PRAGMA foreign_keys=ON');
db.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
const seed = JSON.parse(fs.readFileSync(path.join(root, 'seed.json'), 'utf8'));
const addRestaurant = db.prepare('INSERT OR IGNORE INTO restaurants(restaurant_id,name,city,cuisine) VALUES(?,?,?,?)');
const addTable = db.prepare('INSERT OR IGNORE INTO restaurant_tables(table_id,restaurant_id,table_number,capacity) VALUES(?,?,?,?)');
db.exec('BEGIN');
try {
  for (const r of seed.restaurants) addRestaurant.run(r.id,r.name,r.area,r.kind);
  for (const t of seed.tables) addTable.run(t.id,t.restaurantId,t.number,t.seats);
  db.exec('COMMIT');
} catch(e) {db.exec('ROLLBACK'); throw e;}
const query = `SELECT r.*,c.full_name,c.phone,t.restaurant_id FROM reservations r JOIN customers c ON r.customer_id=c.customer_id JOIN restaurant_tables t ON r.table_id=t.table_id`;
function dto(r) {return {id:'ST-'+String(r.reservation_id).padStart(6,'0'),restaurantId:r.restaurant_id,tableId:r.table_id,name:r.full_name,phone:r.phone,date:r.start_at.slice(0,10),time:r.start_at.slice(11,16),guests:r.party_size,status:r.status};}
function send(res,code,data) {const bytes=Buffer.from(JSON.stringify(data));res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);}
function fail(msg) {const e=new Error(msg);e.status=400;throw e;}
function parseDate(date,time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))fail('תאריך או שעה לא תקינים');
  const start=new Date(`${date}T${time}:00`);
  if(Number.isNaN(start.getTime())||start.getFullYear()!==Number(date.slice(0,4))||start.getMonth()+1!==Number(date.slice(5,7))||start.getDate()!==Number(date.slice(8,10))||start.getHours()!==Number(time.slice(0,2))||start.getMinutes()!==Number(time.slice(3)))fail('תאריך או שעה לא תקינים');
  if(start<=new Date())fail('יש לבחור מועד עתידי');
  if(![0,30].includes(start.getMinutes())||start.getHours()<12||start.getHours()>22||(start.getHours()===22&&start.getMinutes()!==0))fail('השעה מחוץ לטווח ההזמנות');
  const end=new Date(start.getTime()+120*60000);
  const format=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  return [format(start),format(end)];
}
function create(body) {
  const name=String(body.name??'').trim(),phone=String(body.phone??'').replace(/\D/g,'');
  const guests=Number(body.guests),tableId=Number(body.tableId),restaurantId=Number(body.restaurantId);
  if(name.length<2||name.length>100||phone.length<9||phone.length>15||!Number.isInteger(guests)||guests<1||guests>12)fail('פרטי הלקוח או מספר הסועדים אינם תקינים');
  if(!Number.isInteger(tableId)||!Number.isInteger(restaurantId))fail('שולחן או מסעדה לא תקינים');
  const [start,end]=parseDate(String(body.date??''),String(body.time??''));
  db.exec('BEGIN IMMEDIATE');
  try {
    const table=db.prepare('SELECT * FROM restaurant_tables WHERE table_id=? AND restaurant_id=?').get(tableId,restaurantId);
    if(!table||table.capacity<guests)fail('השולחן אינו מתאים להזמנה');
    const overlap=db.prepare('SELECT 1 FROM reservations WHERE table_id=? AND status=? AND start_at<? AND end_at>? LIMIT 1').get(tableId,'confirmed',end,start);
    if(overlap)fail('השולחן כבר תפוס בשעה הזאת. בחרו שעה אחרת');
    db.prepare('INSERT INTO customers(full_name,phone) VALUES(?,?) ON CONFLICT(phone) DO UPDATE SET full_name=excluded.full_name').run(name,phone);
    const customerId=db.prepare('SELECT customer_id FROM customers WHERE phone=?').get(phone).customer_id;
    const id=db.prepare('INSERT INTO reservations(customer_id,table_id,start_at,end_at,party_size,status) VALUES(?,?,?,?,?,?)').run(customerId,tableId,start,end,guests,'confirmed').lastInsertRowid;
    const booking=dto(db.prepare(query+' WHERE r.reservation_id=?').get(id));
    db.exec('COMMIT');return booking;
  }catch(e){db.exec('ROLLBACK');throw e;}
}
function cancel(id,body){
  const phone=String(body.phone??'').replace(/\D/g,'');
  const booking=db.prepare(query+' WHERE r.reservation_id=?').get(Number(id));
  if(!booking||booking.phone!==phone)fail('לא נמצאה הזמנה תואמת');
  db.prepare('UPDATE reservations SET status=? WHERE reservation_id=?').run('cancelled',Number(id));
  return {ok:true};
}
const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  try {
    if(req.method==='GET'&&(pathname==='/'||pathname==='/index.html')) {
      const html=fs.readFileSync(path.join(root,'index.html'));
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':html.length});res.end(html);return;
    }
    if(req.method==='GET'&&['/manifest.webmanifest','/sw.js','/icon-180.png','/icon-192.png','/icon-512.png'].includes(pathname)) {
      const filename=pathname.slice(1);
      const data=fs.readFileSync(path.join(root,filename));
      const type=filename.endsWith('.png')?'image/png':filename.endsWith('.js')?'application/javascript; charset=utf-8':'application/manifest+json; charset=utf-8';
      res.writeHead(200,{'Content-Type':type,'Content-Length':data.length,'Cache-Control':'no-cache'});res.end(data);return;
    }
    if(req.method==='GET'&&pathname==='/api/bookings')return send(res,200,db.prepare(query+' ORDER BY r.reservation_id').all().map(dto));
    if(req.method==='POST'){
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>10000)fail('הבקשה גדולה מדי');}
      let body;try{body=JSON.parse(raw||'{}')}catch{fail('JSON לא תקין')}
      if(pathname==='/api/bookings')return send(res,201,create(body));
      const match=pathname.match(/^\/api\/bookings\/ST-(\d+)\/cancel$/);
      if(match)return send(res,200,cancel(match[1],body));
    }
    return send(res,404,{error:'לא נמצא'});
  }catch(e){console.error(e.message);return send(res,e.status|| (e.message.startsWith('SQLITE_')?500:400),{error:e.status||!e.message.startsWith('SQLITE_')?e.message:'שגיאה במסד הנתונים'});}
});
if(require.main===module){ const port=Number(process.env.PORT)||8000; const host=process.env.HOST||'0.0.0.0'; server.listen(port,host,()=>console.log(`SEATO: http://localhost:${port}`)); }
module.exports={server,db};
