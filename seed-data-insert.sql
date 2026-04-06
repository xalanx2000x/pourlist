-- Pour List — Phase 1 Seed Data (17 Pearl District venues)
-- All addresses verified via Nominatim/OpenStreetMap
-- Status: unverified (awaiting photo upload from field verification)

insert into venues (name, address, lat, lng, zip, phone, website, type, status, contributor_trust) values
('The Fields Bar & Grill', '1314 NW Glisan St', 45.5263373, -122.6845970, '97209', '(503) 243-1313', 'thefieldspdx.com', 'Bar & Grill', 'unverified', 'new'),
('Teardrop Cocktail Lounge', '1015 NW Everett St', 45.5252402, -122.6816527, '97209', '(503) 445-8109', 'teardroplounge.com', 'Cocktail Lounge', 'unverified', 'new'),
('River Pig Saloon', '529 NW 13th Ave', 45.5268858, -122.6844806, '97209', '(971) 266-8897', 'riverpigsaloon.com', 'Sports Bar', 'unverified', 'new'),
('Pink Rabbit', '232 NW 12th Ave', 45.5248754, -122.6830022, '97209', '(503) 281-3330', 'pinkrabbitbar.com', 'Cocktail Bar & Kitchen', 'unverified', 'new'),
('Fools and Horses', '226 NW 12th Ave', 45.5247844, -122.6829993, '97209', null, 'foolsandhorsespdx.com', 'Cocktail Bar & Kitchen', 'unverified', 'new'),
('Bar Rione', '804 NW 12th Ave', 45.5287878, -122.6831611, '97209', null, 'barrione.com', 'Italian Wine & Cocktail Bar', 'unverified', 'new'),
('Olive or Twist', '925 NW 11th Ave', 45.5296494, -122.6825573, '97209', '(503) 546-2900', 'oliveortwistmartinibar.com', 'Martini Bar', 'unverified', 'new'),
('Carlita''s', '1101 NW Northrup St', 45.5316354, -122.6826333, '97209', '(503) 477-5945', 'carlitaspdx.com', 'Mexican Restaurant & Bar', 'unverified', 'new'),
('Bantam Tavern', '922 NW 21st Ave', 45.5295489, -122.6943395, '97209', '(503) 274-9032', 'bantamtavern.com', 'Brewpub / Cocktail Bar', 'unverified', 'new'),
('Silk Road', '1230 NW Hoyt St Suite B', 45.5270177, -122.6838995, '97209', '(503) 389-3166', 'silkroadpdx.com', 'Cocktail Lounge & Kitchen', 'unverified', 'new'),
('Screen Door (Pearl)', '1137 NW 11th Ave', 45.5307943, -122.6824196, '97209', '(503) 833-5613', 'screendoorrestaurant.com', 'Southern Food', 'unverified', 'new'),
('The Triple Lindy', '1000 NW 17th Ave', 45.5300985, -122.6883188, '97209', '(971) 266-8499', 'triplelindypdx.com', 'Neighborhood Bar', 'unverified', 'new'),
('Paymaster Lounge', '1020 NW 17th Ave', 45.5303852, -122.6882720, '97209', '(503) 943-2780', 'paymasterlounge.com', 'Cocktail Lounge', 'unverified', 'new'),
('Two Wrongs', '617 NW 13th Ave', 45.5275236, -122.6845251, '97209', '(971) 279-2667', 'twowrongspdx.com', 'Cocktail Lounge', 'unverified', 'new'),
('Low Brow Lounge', '1036 NW Hoyt St', 45.5271317, -122.6818681, '97209', '(503) 226-0200', 'lowbrowpdx.com', 'Dive Bar', 'unverified', 'new'),
('Brix Tavern (Pearl)', '1338 NW Hoyt St', 45.5270778, -122.6848826, '97209', '(503) 943-5995', 'brixtavern.com', 'Sports Bar / Tavern', 'unverified', 'new'),
('Jojo', '902 NW 13th Ave', 45.5295183, -122.6841969, '97209', '(971) 279-4656', 'jojopdx.com', 'Chicken Sandwiches / Bar', 'unverified', 'new');
