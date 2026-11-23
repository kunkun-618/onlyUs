const __uniConfig = {"pages":[],"globalStyle":{"navigationBarTextStyle":"black","navigationBarTitleText":"我们俩","navigationBarBackgroundColor":"#faf8f5","backgroundColor":"#faf8f5"},"appname":"我们俩","compilerVersion":"5.34","entryPagePath":"pages/index/index","entryPageQuery":"","realEntryPagePath":"","themeConfig":{}};
__uniConfig.getTabBarConfig = () =>  {return undefined};
__uniConfig.tabBar = __uniConfig.getTabBarConfig();
const __uniRoutes = [{"path":"pages/index/index","meta":{"isQuit":true,"isEntry":true,"navigationBarTitleText":"我们俩","navigationStyle":"custom","disableScroll":true}}].map(uniRoute=>(uniRoute.meta.route=uniRoute.path,__uniConfig.pages.push(uniRoute.path),uniRoute.path='/'+uniRoute.path,uniRoute)).concat(typeof __uniSystemRoutes !== 'undefined' ? __uniSystemRoutes : []);

