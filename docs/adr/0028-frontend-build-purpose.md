# ADR 0028. Назначение frontend задаётся при сборке

## Контекст

A07 имеет отдельный рабочий ManagerApp, но технический router продолжает
публично открывать демонстрационный `/managers`. Скрытие ссылки сохраняет
fixtures в production artifact. Один TypeScript program включает оба
интерфейса и глобальную регистрацию технического TanStack router.
После удаления demo route его типизированный `useSearch` теряет маршрут.

## Решение

Три фиксированных назначения `core`, `managers`, `demo` выбирают entry,
output и запрещённые зависимости в единственной таблице Vite.
Docker имеет одноимённые targets. Последний target и привычный
`npm run build` собирают безопасный core. Runtime env, Host и localStorage
не меняют содержимое артефакта. Неизвестный Vite purpose завершает сборку.

Технический router содержит только реальные страницы и login.
Существующий ManagerApp остаётся отдельной entry без TanStack Register.
Маленький demo router владеет chooser, `/login` и `/managers` и использует
существующие boards без копирования fixtures. Демо не импортирует API
клиент, не принимает рабочий вход и не проксирует `/api/`.

Общие compilerOptions вынесены в base. Solution с пустым files ссылается
на core, managers, demo и node programs. Core исключает demo boards,
manager включает только manager root, demo включает demo и boards.
Общие модули входят транзитивно без копирования. Каждому program принадлежит
отдельный tsBuildInfoFile. Core и demo Register проверяются независимо.
`npm run lint` и все build-команды вызывают `tsc -b` всей solution.

Vite guard проверяет `chunk.modules` в `generateBundle`, отклоняет
запрещённый модуль и публикует `module-graph.json` с реальным списком.
Negative tests внедряют импорт настоящих fixtures в production entry
и проверяют отказ настоящего сборщика. Отдельная проверка marker-строк
не заменяет граф. Core nginx отклоняет legacy demo URL, тогда как
`/managers` рабочего manager artifact остаётся действующим маршрутом.

Два прежних demo Playwright suite перенесены в отдельный testDir.
Канонический e2e запускает technical suite на core и demo suite на отдельном
Docker service без API. Обязательные release specs и HTTPS ingress
добавляются следующей единицей [плана A08](../plan/manager-release-v1.md).

## Отклонённые варианты

Runtime demo flag оставляет учебный код в рабочем артефакте.
Один Docker target с произвольным purpose build arg требует согласовывать
выбранный output и nginx policy вручную. Две глобальные Register
augmentation в одном program конфликтуют. Union router, `any` или
подавление ошибок скрывают конфликт вместо разделения назначений.

## Последствия

Frontend release имеет два production image и отдельный тестовый image.
Build graph и типы проверяются без API или рабочих credentials.
Повторная проверка общих модулей в нескольких programs допустима.
Это решение не заменяет серверные audience, CSRF и grants и не подтверждает
HTTPS-приёмку. ADR-0023 сохраняет семантику локального demo state,
а этот ADR ограничивает его отдельным артефактом.
