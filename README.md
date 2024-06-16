# hikka-sync
Sync your anime history between Hikka and MAL* &amp; AniList.
**Currently only Anilist is supported.**
## deploy
For it to work you need to set `HIKKA_USERNAME` and `ANILIST_IMPLICIT_AUTH`.

More about AniList auth can be read [here](https://anilist.gitbook.io/anilist-apiv2-docs/overview/oauth/implicit-grant). Then:
>docker build -t hikka-sync .

>docker run -d --restart=always --name hikka-sync hikka-sync
### License
The source code for the site is licensed under the [MIT](LICENSE) license.