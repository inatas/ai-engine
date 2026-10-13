import { Body, Controller, Get, Post, Put, Param, Query, Req, Res, Inject, HttpCode } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthRequest } from '../auth/service.js';
import { ContentService } from './service.js';
import { WorldService } from '../world/service.js';
import { GenerationService } from './generation.js';
import { AuthService } from '../auth/service.js';

@Controller('api')
export class ContentController {
  constructor(@Inject(ContentService) private content: ContentService,
    @Inject(GenerationService) private generation: GenerationService, @Inject(AuthService) private identity: AuthService) {}
  @Get('templates') templates(@Query() query: { offset?: string; limit?: string }) { return this.content.templates(query).then(data => ({ data })); }
  @Get('drafts') drafts(@Req() request: AuthRequest, @Query() query: { offset?: string; limit?: string }) {
    return this.content.drafts(request.principal!.user_id, query).then(data => ({ data }));
  }
  @Post('drafts') create(@Req() request: AuthRequest, @Body() body: unknown) { return this.content.create(request.principal!.user_id, body).then(data => ({ data })); }
  @Post('drafts/import') import(@Req() request: AuthRequest, @Body() body: unknown) { return this.content.import(request.principal!.user_id, body).then(data => ({ data })); }
  @Get('drafts/:id') get(@Req() request: AuthRequest, @Param('id') id: string) { return this.content.getDraft(request.principal!.user_id, id).then(data => ({ data })); }
  @Put('drafts/:id') save(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: unknown) { return this.content.save(request.principal!.user_id, id, body).then(data => ({ data })); }
  @Post('drafts/:id/validate') @HttpCode(200) validate(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: unknown) { return this.content.validate(request.principal!.user_id, id, body).then(data => ({ data })); }
  @Post('drafts/:id/generate') @HttpCode(200)
  async generate(@Req() request: AuthRequest, @Res({ passthrough: true }) response: Response, @Param('id') id: string, @Body() body: unknown) {
    const cancellation = new AbortController(), owner = request.principal!.user_id;
    const closed = () => { if (!response.writableEnded) cancellation.abort(); };
    response.on('close', closed);
    try {
      const data = await this.generation.generate(owner, id, body, cancellation.signal, async () => {
        delete request.authSession;
        if ((await this.identity.requirePrincipal(request)).user_id !== owner) throw new Error('identity changed');
      });
      return { data };
    } finally { response.off('close', closed); }
  }
  @Post('drafts/:id/preview') preview(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: unknown) { return this.content.preview(request.principal!.user_id, id, body).then(data => ({ data })); }
  @Post('drafts/:id/releases') release(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: unknown) { return this.content.publish(request.principal!.user_id, id, body).then(data => ({ data })); }
  @Get('drafts/:id/export') export(@Req() request: AuthRequest, @Param('id') id: string, @Query('expected_revision') revision?: string) { return this.content.export(request.principal!.user_id, id, revision).then(data => ({ data })); }
  @Get('releases') releases(@Req() request: AuthRequest, @Query() query: { offset?: string; limit?: string }) { return this.content.releases(request.principal!.user_id, query).then(data => ({ data })); }
  @Get('releases/:id') getRelease(@Req() request: AuthRequest, @Param('id') id: string) { return this.content.getRelease(request.principal!.user_id, id).then(data => ({ data })); }
}

@Controller('api/world-sessions')
export class WorldController {
  constructor(@Inject(WorldService) private worlds: WorldService) {}
  @Get() list(@Req() request: AuthRequest, @Query() query: { offset?: string; limit?: string; mode?: string }) { return this.worlds.list(request.principal!.user_id, query).then(data => ({ data })); }
  @Post() create(@Req() request: AuthRequest, @Body() body: unknown) { return this.worlds.create(request.principal!.user_id, body).then(data => ({ data })); }
  @Get(':id') get(@Req() request: AuthRequest, @Param('id') id: string) { return this.worlds.get(request.principal!.user_id, id).then(data => ({ data })); }
  @Get(':id/debug') debug(@Req() request: AuthRequest, @Param('id') id: string) { return this.worlds.debug(request.principal!.user_id, id).then(data => ({ data })); }
  @Post(':id/turns') @HttpCode(200) turn(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: unknown) { return this.worlds.turn(request.principal!.user_id, id, body).then(data => ({ data })); }
  @Post(':id/saves') save(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: unknown) { return this.worlds.save(request.principal!.user_id, id, body).then(data => ({ data })); }
}

@Controller('api/saves')
export class SaveController {
  constructor(@Inject(WorldService) private worlds: WorldService) {}
  @Get() list(@Req() request: AuthRequest, @Query() query: { offset?: string; limit?: string }) { return this.worlds.saves(request.principal!.user_id, query).then(data => ({ data })); }
  @Get(':id') get(@Req() request: AuthRequest, @Param('id') id: string) { return this.worlds.getSave(request.principal!.user_id, id).then(data => ({ data })); }
  @Post(':id/restore') restore(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: unknown) { return this.worlds.restore(request.principal!.user_id, id, body).then(data => ({ data })); }
}
