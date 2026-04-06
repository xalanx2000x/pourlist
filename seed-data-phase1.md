# Pearl District Happy Hours — Phase 1 Seed Data
**Zip: 97209 | Status: Verified addresses, unverified happy hour details**
**Last updated: 2026-04-05**

---

## VENUES — Pearl District (97209)

```
Name,Address,City,State,ZIP,Phone,Website,Type,HappyHourDetails,Status
The Fields Bar & Grill,1314 NW Glisan St,Portland,OR,97209,(503) 243-1313,thefieldspdx.com,Bar & Grill,HAPPY_HOUR_UNVERIFIED,active
Teardrop Cocktail Lounge,1015 NW Everett St,Portland,OR,97209,(503) 445-8109,teardroplounge.com,Cocktail Lounge,HAPPY_HOUR_UNVERIFIED,active
River Pig Saloon,529 NW 13th Ave,Portland,OR,97209,(971) 266-8897,riverpigsaloon.com,Sports Bar / Saloon,HAPPY_HOUR_UNVERIFIED,active
Pink Rabbit,232 NW 12th Ave,Portland,OR,97209,(503) 281-3330,pinkrabbitbar.com,Cocktail Bar & Kitchen,HAPPY_HOUR_UNVERIFIED,active
Fools and Horses,226 NW 12th Ave,Portland,OR,97209,,foolsandhorsespdx.com,Cocktail Bar & Kitchen,HAPPY_HOUR_UNVERIFIED,active
Bar Rione,804 NW 12th Ave,Portland,OR,97209,,barrione.com,Italian Wine & Cocktail Bar,HAPPY_HOUR_UNVERIFIED,active
Olive or Twist,925 NW 11th Ave,Portland,OR,97209,(503) 546-2900,oliveortwistmartinibar.com,Martini Bar,HAPPY_HOUR_UNVERIFIED,active
Carlita's,1101 NW Northrup St,Portland,OR,97209,(503) 477-5945,carlitaspdx.com,Mexican Restaurant & Bar,HAPPY_HOUR_UNVERIFIED,active
Bantam Tavern,922 NW 21st Ave,Portland,OR,97209,(503) 274-9032,bantamtavern.com,Brewpub / Cocktail Bar,HAPPY_HOUR_UNVERIFIED,active
Silk Road,1230 NW Hoyt St Suite B,Portland,OR,97209,(503) 389-3166,silkroadpdx.com,Cocktail Lounge & Kitchen,HAPPY_HOUR_UNVERIFIED,active
Screen Door (Pearl),1137 NW 11th Ave,Portland,OR,97209,(503) 833-5613,screendoorrestaurant.com,Southern Food / Fried Chicken,HAPPY_HOUR_UNVERIFIED,active
The Triple Lindy,1000 NW 17th Ave,Portland,OR,97209,(971) 266-8499,triplelindypdx.com,Neighborhood Bar,HAPPY_HOUR_UNVERIFIED,active
Paymaster Lounge,1020 NW 17th Ave,Portland,OR,97209,(503) 943-2780,paymasterlounge.com,Cocktail Lounge,HAPPY_HOUR_UNVERIFIED,active
Two Wrongs,617 NW 13th Ave,Portland,OR,97209,(971) 279-2667,twowrongspdx.com,Cocktail Lounge,HAPPY_HOUR_UNVERIFIED,active
Low Brow Lounge,1036 NW Hoyt St,Portland,OR,97209,(503) 226-0200,lowbrowpdx.com,Dive Bar,HAPPY_HOUR_UNVERIFIED,active
Brix Tavern (Pearl),1338 NW Hoyt St,Portland,OR,97209,(503) 943-5995,brixtavern.com,Sports Bar / Tavern,HAPPY_HOUR_UNVERIFIED,active
Jojo,902 NW 13th Ave,Portland,OR,97209,(971) 279-4656,jojopdx.com,Chicken Sandwiches / Bar,HAPPY_HOUR_UNVERIFIED,active
```

---

## CLOSED — Do not include

```
Name,Address,Note
Bridgeport Brew Pub,1313 NW Marshall St,Closed 2019 (brewery), Pearl Tavern,804 NW 12th Ave,Closed 2025
```

---

## UNVERIFIED — May be in 97209, needs confirmation

```
Name,Address,Source,Note
Verde Cocina,1012 NW Glisan St,OpenTable,"mentioned as Pearl District, happy hour Mon-Sat"
Life of Riley,,Pearl District Portfolio,"mentioned as reliable happy hour spot, address unconfirmed"
Secret Grove,,Yelp bars list,"listed as bar in 97209, no confirmed address yet"
Amtrak Metropolitan Lounge,,Yelp bars list,"likely Amtrak station lounge, likely not relevant"
Swine Moonshine & Whiskey Bar,,OpenTable,"described in article, address unconfirmed"
```

---

## HAPPY HOUR DETAILS — Fields Bar & Grill (example of what needs on-site verification)

Once you visit each place, fill in:
- `happy_hour_start` — e.g. "15:00"
- `happy_hour_end` — e.g. "17:00"
- `happy_hour_days` — e.g. "mon,tue,wed,thu,fri"
- `late_night_start` — if second window, e.g. "21:00"
- `late_night_end` — e.g. "close"
- `drink_deals` — e.g. "$5 wells, $3 pints"
- `food_deals` — e.g. "$7 sliders"
- `notes` — anything notable

---

## NEXT STEPS

1. [ ] Tyler walks Pearl District with phone, snaps photos of happy hour menus at each venue
2. [ ] Photos uploaded to app → stored in Supabase
3. [ ] I extract happy hour details from photos → update venue records
4. [ ] Add venues from "Unverified" list once confirmed
5. [ ] Cron job: flag venues with no photo uploads in 90 days
