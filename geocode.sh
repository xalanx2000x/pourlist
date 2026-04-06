#!/bin/bash
# Geocode Pearl District addresses using Nominatim

echo "Name,Address,Lat,Lng"
curl -s "https://nominatim.openstreetmap.org/search?street=1314+NW+Glisan+St&city=Portland&state=OR&postalcode=97209&format=json&limit=1" -H "User-Agent: PourList/1.0" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('The Fields Bar & Grill,1314 NW Glisan St,'+d[0].lat+','+d[0].lon)"
sleep 1.1
curl -s "https://nominatim.openstreetmap.org/search?street=1015+NW+Everett+St&city=Portland&state=OR&postalcode=97209&format=json&limit=1" -H "User-Agent: PourList/1.0" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Teardrop Cocktail Lounge,1015 NW Everett St,'+d[0].lat+','+d[0].lon)"
sleep 1.1
curl -s "https://nominatim.openstreetmap.org/search?street=529+NW+13th+Ave&city=Portland&state=OR&postalcode=97209&format=json&limit=1" -H "User-Agent: PourList/1.0" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('River Pig Saloon,529 NW 13th Ave,'+d[0].lat+','+d[0].lon)"
sleep 1.1
curl -s "https://nominatim.openstreetmap.org/search?street=232+NW+12th+Ave&city=Portland&state=OR&postalcode=97209&format=json&limit=1" -H "User-Agent: PourList/1.0" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Pink Rabbit,232 NW 12th Ave,'+d[0].lat+','+d[0].lon)"
sleep 1.1
curl -s "https://nominatim.openstreetmap.org/search?street=226+NW+12th+Ave&city=Portland&state=OR&postalcode=97209&format=json&limit=1" -H "User-Agent: PourList/1.0" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Fools and Horses,226 NW 12th Ave,'+d[0].lat+','+d[0].lon)"
sleep 1.1
curl -s "https://nominatim.openstreetmap.org/search?street=804+NW+12th+Ave&city=Portland&state=OR&postalcode=97209&format=json&limit=1" -H "User-Agent: PourList/1.0" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Bar Rione,804 NW 12th Ave,'+d[0].lat+','+d[0].lon)"
sleep 1.1
curl -s "https://nominatim.openstreetmap.org/search?street=925+NW+11th+Ave&city=Portland&state=OR&postalcode=97209&format=json&limit=1" -H "User-Agent: PourList/1.0" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Olive or Twist,925 NW 11th Ave,'+d[0].lat+','+d[0].lon)"
sleep 1.1
curl -s "https://nominatim.openstreetmap.org/search?street=1101+NW+Northrup+St&city=Portland&state=OR&postalcode=97209&format=json&limit=1" -H "User-Agent: PourList/1.0" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Carlita'\''s,1101 NW Northrup St,'+d[0].lat+','+d[0].lon)"
sleep 1.1
curl -s "https://nominatim.openstreetmap.org/search?street=922+NW+21st+Ave&city=Portland&state=OR&postalcode=97209&format=json&limit=1" -H "User-Agent: PourList/1.0" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Bantam Tavern,922 NW 21st Ave,'+d[0].lat+','+d[0].lon)"
sleep 1.1
curl -s "https://nominatim.openstreetmap.org/search?street=1230+NW+Hoyt+St&city=Portland&state=OR&postalcode=97209&format=json&limit=1" -H "User-Agent: PourList/1.0" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Silk Road,1230 NW Hoyt St,'+d[0].lat+','+d[0].lon)"
sleep 1.1
curl -s "https://nominatim.openstreetmap.org/search?street=1137+NW+11th+Ave&city=Portland&state=OR&postalcode=97209&format=json&limit=1" -H "User-Agent: PourList/1.0" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Screen Door (Pearl),1137 NW 11th Ave,'+d[0].lat+','+d[0].lon)"
sleep 1.1
curl -s "https://nominatim.openstreetmap.org/search?street=1000+NW+17th+Ave&city=Portland&state=OR&postalcode=97209&format=json&limit=1" -H "User-Agent: PourList/1.0" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('The Triple Lindy,1000 NW 17th Ave,'+d[0].lat+','+d[0].lon)"
sleep 1.1
curl -s "https://nominatim.openstreetmap.org/search?street=1020+NW+17th+Ave&city=Portland&state=OR&postalcode=97209&format=json&limit=1" -H "User-Agent: PourList/1.0" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Paymaster Lounge,1020 NW 17th Ave,'+d[0].lat+','+d[0].lon)"
sleep 1.1
curl -s "https://nominatim.openstreetmap.org/search?street=617+NW+13th+Ave&city=Portland&state=OR&postalcode=97209&format=json&limit=1" -H "User-Agent: PourList/1.0" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Two Wrongs,617 NW 13th Ave,'+d[0].lat+','+d[0].lon)"
sleep 1.1
curl -s "https://nominatim.openstreetmap.org/search?street=1036+NW+Hoyt+St&city=Portland&state=OR&postalcode=97209&format=json&limit=1" -H "User-Agent: PourList/1.0" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Low Brow Lounge,1036 NW Hoyt St,'+d[0].lat+','+d[0].lon)"
sleep 1.1
curl -s "https://nominatim.openstreetmap.org/search?street=1338+NW+Hoyt+St&city=Portland&state=OR&postalcode=97209&format=json&limit=1" -H "User-Agent: PourList/1.0" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Brix Tavern (Pearl),1338 NW Hoyt St,'+d[0].lat+','+d[0].lon)"
sleep 1.1
curl -s "https://nominatim.openstreetmap.org/search?street=902+NW+13th+Ave&city=Portland&state=OR&postalcode=97209&format=json&limit=1" -H "User-Agent: PourList/1.0" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Jojo,902 NW 13th Ave,'+d[0].lat+','+d[0].lon)"
