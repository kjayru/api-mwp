import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { SearchQueryDto } from './dto/search-query.dto.js';
import { type SearchResults, SearchService } from './search.service.js';

@Roles('ADMIN', 'EDITOR')
@Controller('admin/search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /** Cases, blog posts, leads and conversations, up to 5 of each. */
  @Get()
  search(@Query() query: SearchQueryDto): Promise<SearchResults> {
    return this.searchService.search(query.q);
  }
}
