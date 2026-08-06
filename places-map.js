const STORAGE_KEY = "lulu-dengdeng-map-pins";
const map = L.map("world-map", { center:[24,38], zoom:2, minZoom:2, maxZoom:18, worldCopyJump:true, zoomControl:false });
L.control.zoom({ position:"bottomright" }).addTo(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution:"&copy; OpenStreetMap contributors", maxZoom:19 }).addTo(map);

const footprintIcon = L.divIcon({ className:"memory-marker-wrap", html:'<div class="memory-marker"></div>', iconSize:[34,44], iconAnchor:[17,42], popupAnchor:[0,-38] });
function pinIcon(type){return L.divIcon({className:"custom-marker-wrap",html:`<div class="custom-marker ${type === "footprint" ? "footprint-marker" : "wish-marker"}"></div>`,iconSize:[28,40],iconAnchor:[14,38],popupAnchor:[0,-35]})}

const memories=[
  {name:"上海",en:"SHANGHAI",lat:31.2304,lng:121.4737,page:"shanghai.html"},
  {name:"香港",en:"HONG KONG",lat:22.3193,lng:114.1694,page:"hongkong.html"},
  {name:"深圳",en:"SHENZHEN",lat:22.5431,lng:114.0579,page:"shenzhen.html"}
];
memories.forEach(place=>L.marker([place.lat,place.lng],{icon:footprintIcon,title:place.name,alt:place.name}).addTo(map).bindPopup(`<div class="memory-popup"><small>FOOTPRINT · ${place.en}</small><b>${place.name}</b><a href="${place.page}">打开城市回忆 →</a></div>`));

let pins=loadPins(),pinMarkers=[],addingType=null;
const footprintButton=document.getElementById("add-footprint"),wishButton=document.getElementById("add-wish"),modeLabel=document.getElementById("map-mode");
function loadPins(){try{return(JSON.parse(localStorage.getItem(STORAGE_KEY))||[]).map(pin=>({...pin,type:pin.type||"wish"}))}catch{return[]}}
function savePins(){localStorage.setItem(STORAGE_KEY,JSON.stringify(pins));document.getElementById("pin-count").textContent=String(memories.length+pins.length)}
function escapeHtml(text){return text.replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char])}
function pinPopup(pin){const footprint=pin.type==="footprint";return `<div class="custom-popup ${pin.type}"><small>${footprint?"OUR FOOTPRINT":"OUR WISH"}</small><b>${escapeHtml(pin.name)}</b><span>${footprint?"足迹":"愿望"} · ${pin.lat.toFixed(3)}°, ${pin.lng.toFixed(3)}°</span></div>`}
function renderPins(){pinMarkers.forEach(marker=>marker.remove());pinMarkers=pins.map((pin,index)=>{const marker=L.marker([pin.lat,pin.lng],{icon:pinIcon(pin.type),draggable:true,title:pin.name,alt:pin.name}).addTo(map).bindPopup(pinPopup(pin));marker.on("dragend",event=>{const point=event.target.getLatLng();pins[index].lat=point.lat;pins[index].lng=point.lng;marker.setPopupContent(pinPopup(pins[index]));savePins()});return marker});savePins()}
function setAddingMode(type){addingType=type;footprintButton.classList.toggle("active",type==="footprint");wishButton.classList.toggle("active",type==="wish");footprintButton.innerHTML=type==="footprint"?"取消添加":"<span>＋</span> 添加足迹";wishButton.innerHTML=type==="wish"?"取消添加":"<span>＋</span> 添加愿望";modeLabel.textContent=type==="footprint"?"点击地图，添加绿色足迹":type==="wish"?"点击地图，添加红色愿望":"浏览地图";document.getElementById("world-map").classList.toggle("pinning",Boolean(type))}
footprintButton.addEventListener("click",()=>setAddingMode(addingType==="footprint"?null:"footprint"));wishButton.addEventListener("click",()=>setAddingMode(addingType==="wish"?null:"wish"));
map.on("click",event=>{if(!addingType)return;const selectedType=addingType;const defaultName=selectedType==="footprint"?"我们去过的地方":"想和你去的地方";const name=window.prompt("给这个地方起一个名字：",defaultName);if(name&&name.trim()){pins.push({name:name.trim(),type:selectedType,lat:event.latlng.lat,lng:event.latlng.lng});renderPins();pinMarkers[pinMarkers.length-1].openPopup()}setAddingMode(null)});
document.getElementById("undo-pin").addEventListener("click",()=>{if(!pins.length)return;pins.pop();renderPins()});
document.getElementById("clear-pins").addEventListener("click",()=>{if(!pins.length||!window.confirm("确定清空所有自己添加的足迹和愿望吗？"))return;pins=[];renderPins()});
renderPins();
