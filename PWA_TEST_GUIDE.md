# 🧪 PWA Offline Testing Checklist

After reinstalling the app, test these features to ensure everything works:

## ✅ Installation Test
- [ ] App appears on home screen
- [ ] App icon shows Mat Auto logo
- [ ] App name displays correctly
- [ ] Tapping icon launches full-screen app

## ✅ Online Mode Tests
- [ ] Home page loads quickly
- [ ] Products display with images
- [ ] Can search products
- [ ] Can add items to cart
- [ ] Can view orders
- [ ] Links between pages work

## ✅ Offline Mode Tests

**Before going offline:**
1. Visit these pages while online:
   - [ ] Home (index.html)
   - [ ] About (about.html)
   - [ ] FAQ (faq.html)
   - [ ] Orders (orders.html)
   - [ ] Track (track.html)
   - [ ] Warranty (warranty.html)

2. Look at some products to cache images

**Then disable internet and test:**
- [ ] App doesn't crash
- [ ] Offline page displays helpful message
- [ ] Can navigate to previously visited pages
- [ ] Cached images display
- [ ] Buttons and links work
- [ ] "Try Again" button shows proper message
- [ ] Time updates in countdown (if visible)

## ✅ Reconnection Tests
- [ ] Re-enable internet
- [ ] App detects connection instantly
- [ ] Auto-redirects to home page
- [ ] Fresh data loads (new products)
- [ ] No errors in console

## ✅ Performance Tests
- [ ] App loads in < 2 seconds on 4G
- [ ] App loads in < 5 seconds on 3G
- [ ] Offline pages load instantly (< 500ms)
- [ ] Scrolling is smooth
- [ ] No lag when tapping buttons

## 📊 Cache Verification

**Chrome Developer Tools (Android):**
1. Open app
2. Press `F12` or use Dev Tools
3. Go to `Application` tab
4. Check:
   - [ ] Service Worker is "activated"
   - [ ] Cache Storage shows multiple caches
   - [ ] Network tab shows cached responses

**Safari (iOS):**
1. iPad: Settings → Safari → Advanced → Web Inspector
2. Open app browser dev tools
3. Check console for SW registration messages

## 🐛 If Something Doesn't Work

| Issue | Solution |
|-------|----------|
| Blank page | Close app, reopen, wait 5 seconds |
| Offline page not showing | Clear app cache, reinstall |
| Pages not cached | Visit them again while online |
| Images not showing offline | View them once while online |
| Old content showing | Force refresh (Ctrl+Shift+R on desktop) |
| Service Worker errors | Check console for messages |

## 📝 Expected Behavior

### ✅ Normal Flow
```
1. First install → Service Worker downloads all assets (30 sec)
2. App ready → Full offline functionality
3. Go offline → Can browse cached pages
4. Go online → Content updates automatically
5. Reinstall → Fresh cache, faster startup
```

### ✅ Service Worker Updates
- Checks for updates hourly
- Auto-updates in background
- You don't need to do anything
- Just keep app installed

---

**All tests passing? Your PWA is working perfectly!** 🎉
