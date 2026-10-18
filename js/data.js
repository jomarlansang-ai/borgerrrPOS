// Single data module. Swap these functions for Firebase (Auth + Firestore) later.
// Sample data only. No real keys, secrets or shop data.
window.DataStore=(function(){
 const KEY='borgerrr_sample_v1';
 const seed={menu:[{id:1,name:'Classic Borgerrr',price:129,cost:55},{id:2,name:'Cheesy Borgerrr',price:149,cost:62},{id:3,name:'Double Patty',price:199,cost:90},{id:4,name:'Fries (Reg)',price:59,cost:18},{id:5,name:'Iced Tea',price:39,cost:9}],
 discounts:{promo:10,senior:20,pwd:20},
 stock:[{id:1,name:'Burger buns',qty:120,unit:'pcs',min:50},{id:2,name:'Beef patties',qty:35,unit:'pcs',min:40},{id:3,name:'Cheese slices',qty:80,unit:'pcs',min:30},{id:4,name:'Potatoes',qty:6,unit:'kg',min:10},{id:5,name:'Tea syrup',qty:4,unit:'L',min:2}],
 sales:[[1,2],[2,1],[3,1],[4,3],[5,4],[1,1],[2,2],[4,2],[3,2],[5,2]].map((s,i)=>({id:i+1,item:s[0],qty:s[1],t:Date.now()-i*1500000})),
 log:[{t:Date.now()-600000,type:'sale',msg:'Order #1010 — ₱337'},{t:Date.now()-1800000,type:'discount',msg:'Senior discount applied on #1008'},{t:Date.now()-3000000,type:'void',msg:'Voided item on #1005 (Fries)'},{t:Date.now()-5000000,type:'admin',msg:'Admin opened shift'}],
 settings:{shop:'BorgerrrPOS Demo Shop',vat:12}};
 let db=JSON.parse(localStorage.getItem(KEY)||'null')||structuredClone(seed);
 const save=()=>localStorage.setItem(KEY,JSON.stringify(db));
 const log=(type,msg)=>{db.log.unshift({t:Date.now(),type,msg});save()};
 return{
  signIn:async()=>({demo:true,name:'Demo Admin'}), // TODO Firebase Auth
  get:()=>db,
  setPrice(id,p){const m=db.menu.find(x=>x.id==id);log('admin',`Price of ${m.name}: ₱${m.price} → ₱${p}`);m.price=p;save()},
  setDiscount(k,v){log('admin',`${k} discount: ${db.discounts[k]}% → ${v}%`);db.discounts[k]=v;save()},
  setStock(id,q){const s=db.stock.find(x=>x.id==id);log('admin',`Stock of ${s.name}: ${s.qty} → ${q}`);s.qty=q;save()},
  setSetting(k,v){db.settings[k]=v;log('admin',`Setting ${k} updated`);save()},
  reset(){db=structuredClone(seed);save()}
 }})();
